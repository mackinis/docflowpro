import type { Hono } from 'hono';
import type { Env, AppVariables } from './types';
import { createAudit, getSystemConfigValue, DEFAULT_SYSTEM_SETTINGS } from './db';
import { sanitizeFileName, guessMimeType, decodeDataUrl } from './document-parser';

type WorkerApp = Hono<{ Bindings: Env; Variables: AppVariables }>;

/** Private system messages, attachment storage, and per-user mailbox operations. */
export function registerSystemMessageRoutes(app: WorkerApp) {
// ============================================================================
// 5. Internal System Messages (Metadata in D1, Attachments in R2)
// ============================================================================
app.post('/api/system-messages', async (c) => {
  const auth = c.get('auth')!;
  const { receiverId, subject, content, attachments } = await c.req.json();
  const sender = auth.user;

  let receiver: { id: string; name: string; lastName: string; role: string } | null = null;
  if (receiverId === 'system') {
    receiver = { id: 'system', name: 'Sistema', lastName: 'de Reasignaciones', role: 'SYSTEM' };
  } else {
    const recRow = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(receiverId).first<any>();
    if (recRow) {
      receiver = { id: recRow.id, name: recRow.name, lastName: recRow.last_name, role: recRow.role };
    }
  }

  if (!receiver) {
    return c.json({ error: 'Destinatario no encontrado.' }, 404);
  }

  const settings = await getSystemConfigValue(c.env.DB, 'systemSettings', DEFAULT_SYSTEM_SETTINGS);
  const configs = settings.roleMessagingConfigs || DEFAULT_SYSTEM_SETTINGS.roleMessagingConfigs!;
  const senderConfig = (configs as any)[sender.role] || { allowed: true, rule: 'free' };

  if (!senderConfig.allowed) {
    return c.json({ error: `Tu rol (${sender.role}) no tiene permisos para enviar mensajes internos.` }, 403);
  }

  if (senderConfig.rule === 'wait_reply') {
    const lastExchanged = await c.env.DB.prepare(
      `SELECT sender_id FROM system_messages
       WHERE ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
         AND permanent_deleted_by_sender = 0
       ORDER BY created_at DESC LIMIT 1`
    )
      .bind(sender.id, receiverId, receiverId, sender.id)
      .first<{ sender_id: string }>();

    if (lastExchanged && lastExchanged.sender_id === sender.id) {
      return c.json(
        {
          error:
            'La política del sistema para tu rol te impide enviar otro mensaje hasta que recibas una respuesta.',
        },
        400
      );
    }
  }

  const msgId = `msg-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO system_messages (id, sender_id, sender_name, sender_role, receiver_id, receiver_name, receiver_role, subject, content, created_at, read, deleted_by_sender, deleted_by_receiver, permanent_deleted_by_sender, permanent_deleted_by_receiver)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)`
  )
    .bind(
      msgId,
      sender.id,
      `${sender.name} ${sender.lastName}`,
      sender.role,
      receiver.id,
      `${receiver.name} ${receiver.lastName}`,
      receiver.role,
      subject || '(Sin Asunto)',
      content,
      now
    )
    .run();

  const savedAttachments: any[] = [];
  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      const attId = `att-${crypto.randomUUID().slice(0, 8)}`;
      const safeName = sanitizeFileName(att.name || 'adjunto');
      const r2Key = `messages/${msgId}/${attId}-${safeName}`;
      let mimeType = guessMimeType(safeName);
      let byteSize = att.size || 0;

      if (att.dataUrl) {
        const decoded = decodeDataUrl(att.dataUrl, mimeType);
        mimeType = decoded.mimeType;
        byteSize = decoded.bytes.byteLength;
        await c.env.R2_BUCKET.put(r2Key, decoded.bytes, {
          httpMetadata: { contentType: mimeType },
        });
      } else if (att.r2Key) {
        const srcObj = await c.env.R2_BUCKET.get(att.r2Key);
        if (srcObj) {
          const buf = new Uint8Array(await srcObj.arrayBuffer());
          mimeType = srcObj.httpMetadata?.contentType || att.mimeType || mimeType;
          byteSize = buf.byteLength;
          await c.env.R2_BUCKET.put(r2Key, buf, {
            httpMetadata: { contentType: mimeType },
          });
        } else {
          await c.env.R2_BUCKET.put(r2Key, new Uint8Array(0), {
            httpMetadata: { contentType: mimeType },
          });
        }
      } else {
        await c.env.R2_BUCKET.put(r2Key, new Uint8Array(0), {
          httpMetadata: { contentType: mimeType },
        });
      }

      await c.env.DB.prepare(
        `INSERT INTO message_attachments (id, message_id, name, mime_type, size, r2_key)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(attId, msgId, att.name || safeName, mimeType, byteSize, r2Key)
        .run();

      savedAttachments.push({
        id: attId,
        name: att.name || safeName,
        mimeType,
        size: byteSize,
        r2Key,
        downloadUrl: `/api/system-messages/attachments/${attId}/download`,
      });
    }
  }

  await createAudit(
    c.env.DB,
    sender.id,
    `Envió un mensaje interno a ${receiver.name} ${receiver.lastName}`,
    'Message',
    msgId,
    subject || '(Sin Asunto)'
  );

  return c.json(
    {
      success: true,
      message: {
        id: msgId,
        senderId: sender.id,
        senderName: `${sender.name} ${sender.lastName}`,
        senderRole: sender.role,
        receiverId: receiver.id,
        receiverName: `${receiver.name} ${receiver.lastName}`,
        receiverRole: receiver.role,
        subject: subject || '(Sin Asunto)',
        content,
        createdAt: now,
        read: false,
        deletedBySender: false,
        deletedByReceiver: false,
        attachments: savedAttachments,
      },
    },
    201
  );
});

app.get('/api/system-messages/attachments/:attachmentId/download', async (c) => {
  const auth = c.get('auth')!;
  const { attachmentId } = c.req.param();
  const att = await c.env.DB.prepare(
    `SELECT a.*, m.sender_id, m.receiver_id
     FROM message_attachments a
     JOIN system_messages m ON m.id = a.message_id
     WHERE a.id = ?`
  )
    .bind(attachmentId)
    .first<any>();

  if (!att) {
    return c.json({ error: 'Adjunto no encontrado.' }, 404);
  }

  const isAdmin = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role);
  if (
    att.sender_id !== auth.user.id &&
    att.receiver_id !== auth.user.id &&
    !(att.receiver_id === 'system' && isAdmin) &&
    !isAdmin
  ) {
    return c.json({ error: 'No autorizado para descargar este adjunto.' }, 403);
  }

  const obj = await c.env.R2_BUCKET.get(att.r2_key);
  if (!obj) {
    return c.json({ error: 'Archivo no encontrado en R2.' }, 404);
  }

  return new Response(obj.body, {
    headers: {
      'Content-Type': att.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${sanitizeFileName(att.name)}"`,
    },
  });
});

app.post('/api/system-messages/read', async (c) => {
  const { messageId } = await c.req.json();
  await c.env.DB.prepare('UPDATE system_messages SET read = 1 WHERE id = ?').bind(messageId).run();
  return c.json({ success: true });
});

app.post('/api/system-messages/trash', async (c) => {
  const auth = c.get('auth')!;
  const { messageId, action } = await c.req.json();
  const msg = await c.env.DB.prepare('SELECT * FROM system_messages WHERE id = ?').bind(messageId).first<any>();
  if (!msg) {
    return c.json({ error: 'Mensaje no encontrado' }, 404);
  }
  const isTrash = action === 'trash' ? 1 : 0;
  const isAdminOrSuper = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role);

  if (msg.sender_id === auth.user.id) {
    await c.env.DB.prepare('UPDATE system_messages SET deleted_by_sender = ? WHERE id = ?')
      .bind(isTrash, messageId)
      .run();
  }
  if (msg.receiver_id === auth.user.id || (msg.receiver_id === 'system' && isAdminOrSuper)) {
    await c.env.DB.prepare('UPDATE system_messages SET deleted_by_receiver = ? WHERE id = ?')
      .bind(isTrash, messageId)
      .run();
  }
  return c.json({ success: true });
});

app.post('/api/system-messages/delete-permanent', async (c) => {
  const auth = c.get('auth')!;
  const { messageId } = await c.req.json();
  const msg = await c.env.DB.prepare('SELECT * FROM system_messages WHERE id = ?').bind(messageId).first<any>();
  if (!msg) {
    return c.json({ error: 'Mensaje no encontrado' }, 404);
  }

  const isAdminOrSuper = ['SUPERADMIN', 'ADMIN'].includes(auth.user.role);
  let delSender = msg.permanent_deleted_by_sender === 1;
  let delReceiver = msg.permanent_deleted_by_receiver === 1;

  if (msg.sender_id === auth.user.id) {
    delSender = true;
    await c.env.DB.prepare('UPDATE system_messages SET permanent_deleted_by_sender = 1 WHERE id = ?')
      .bind(messageId)
      .run();
  }
  if (msg.receiver_id === auth.user.id || (msg.receiver_id === 'system' && isAdminOrSuper)) {
    delReceiver = true;
    await c.env.DB.prepare('UPDATE system_messages SET permanent_deleted_by_receiver = 1 WHERE id = ?')
      .bind(messageId)
      .run();
  }

  if (delSender && delReceiver) {
    const atts = await c.env.DB.prepare('SELECT r2_key FROM message_attachments WHERE message_id = ?')
      .bind(messageId)
      .all<{ r2_key: string }>();
    for (const a of atts.results || []) {
      await c.env.R2_BUCKET.delete(a.r2_key);
    }
    await c.env.DB.prepare('DELETE FROM system_messages WHERE id = ?').bind(messageId).run();
  }

  return c.json({ success: true });
});


}
