import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { INITIAL_STATE } from './src/data';
import { AppDataState, Case, Document, Task, Observation, Notification, AuditLog, ProcessTemplate, User } from './src/types';

// Load env variables
dotenv.config();

// Password hashing helper
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === testHash;
}

// Token generator
function generateVerificationToken(length = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  for (let i = 0; i < length; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Resend Email Helper
async function sendVerificationEmail(email: string, fullName: string, token: string) {
  const apiKey = process.env.RESEND_API_KEY;
  let fromEmail = (process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev').trim();
  
  // Robustly format to satisfy Resend's strict email format validation (email@example.com or Name <email@example.com>)
  if (!fromEmail.includes('@')) {
    fromEmail = 'onboarding@resend.dev';
  }
  if (!fromEmail.includes('<') && fromEmail.includes('@')) {
    fromEmail = `DocFlow Pro <${fromEmail}>`;
  }
  
  if (!apiKey || apiKey === 'MY_RESEND_API_KEY') {
    console.log(`[SIMULACIÓN EMAIL] Para: ${email}, Token: ${token}`);
    return;
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: email,
        subject: 'Código de Verificación - DocFlow Pro',
        html: `
          <div style="font-family: sans-serif; padding: 20px; color: #333; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: #2563eb; margin-top: 0;">¡Bienvenido a DocFlow Pro!</h2>
            <p>Hola <strong>${fullName}</strong>,</p>
            <p>Para completar tu registro y acceder por primera vez a tu cuenta, utiliza el siguiente código de verificación:</p>
            <div style="background: #f3f4f6; padding: 15px; border-radius: 6px; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; color: #1e3a8a; margin: 20px 0;">
              ${token}
            </div>
            <p style="font-size: 13px; color: #666;">
              Si no solicitaste este código, puedes ignorar este correo de forma segura.
              Este token es válido por 30 minutos antes de expirar.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 11px; color: #999; text-align: center;">DocFlow Pro - Soluciones de Gestión Documental</p>
          </div>
        `
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Failed to send verification email via Resend:', errText);
    } else {
      console.log(`Verification email sent successfully to ${email}`);
    }
  } catch (error) {
    console.error('Error sending email via Resend API:', error);
  }
}

// Initialize Firebase client for Firestore persistence
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: `${process.env.FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  appId: process.env.FIREBASE_APP_ID,
};

let firestoreDb: any = null;
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_API_KEY) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = getFirestore(firebaseApp);
    console.log('Connected to Google Firestore successfully.');
  } catch (e) {
    console.error('Failed to connect to Google Firestore:', e);
  }
}

// Sync State to Firestore
async function syncToFirestore(state: AppDataState) {
  if (!firestoreDb) return;
  try {
    await setDoc(doc(firestoreDb, 'docflow', 'users'), { data: state.users });
    await setDoc(doc(firestoreDb, 'docflow', 'templates'), { data: state.templates });
    await setDoc(doc(firestoreDb, 'docflow', 'cases'), { data: state.cases });
    await setDoc(doc(firestoreDb, 'docflow', 'documents'), { data: state.documents });
    await setDoc(doc(firestoreDb, 'docflow', 'tasks'), { data: state.tasks });
    await setDoc(doc(firestoreDb, 'docflow', 'observations'), { data: state.observations });
    await setDoc(doc(firestoreDb, 'docflow', 'notifications'), { data: state.notifications });
    await setDoc(doc(firestoreDb, 'docflow', 'auditLogs'), { data: state.auditLogs });
    await setDoc(doc(firestoreDb, 'docflow', 'formSubmissions'), { data: state.formSubmissions });
    await setDoc(doc(firestoreDb, 'docflow', 'config'), { 
      activeIndustry: state.activeIndustry || 'Inmobiliaria',
      verificationPolicies: state.verificationPolicies || null,
      systemSettings: state.systemSettings || null,
      systemMessages: state.systemMessages || null
    });
  } catch (e) {
    console.error('Error syncing to Firestore:', e);
  }
}

// Load State from Firestore
async function loadFromFirestore(): Promise<Partial<AppDataState> | null> {
  if (!firestoreDb) return null;
  try {
    const usersDoc = await getDoc(doc(firestoreDb, 'docflow', 'users'));
    const templatesDoc = await getDoc(doc(firestoreDb, 'docflow', 'templates'));
    const casesDoc = await getDoc(doc(firestoreDb, 'docflow', 'cases'));
    const documentsDoc = await getDoc(doc(firestoreDb, 'docflow', 'documents'));
    const tasksDoc = await getDoc(doc(firestoreDb, 'docflow', 'tasks'));
    const observationsDoc = await getDoc(doc(firestoreDb, 'docflow', 'observations'));
    const notificationsDoc = await getDoc(doc(firestoreDb, 'docflow', 'notifications'));
    const auditLogsDoc = await getDoc(doc(firestoreDb, 'docflow', 'auditLogs'));
    const formSubmissionsDoc = await getDoc(doc(firestoreDb, 'docflow', 'formSubmissions'));
    const configDoc = await getDoc(doc(firestoreDb, 'docflow', 'config'));

    return {
      users: usersDoc.exists() ? usersDoc.data().data : undefined,
      templates: templatesDoc.exists() ? templatesDoc.data().data : undefined,
      cases: casesDoc.exists() ? casesDoc.data().data : undefined,
      documents: documentsDoc.exists() ? documentsDoc.data().data : undefined,
      tasks: tasksDoc.exists() ? tasksDoc.data().data : undefined,
      observations: observationsDoc.exists() ? observationsDoc.data().data : undefined,
      notifications: notificationsDoc.exists() ? notificationsDoc.data().data : undefined,
      auditLogs: auditLogsDoc.exists() ? auditLogsDoc.data().data : undefined,
      formSubmissions: formSubmissionsDoc.exists() ? formSubmissionsDoc.data().data : undefined,
      activeIndustry: configDoc.exists() ? configDoc.data().activeIndustry : undefined,
      verificationPolicies: configDoc.exists() ? configDoc.data().verificationPolicies : undefined,
      systemSettings: configDoc.exists() ? configDoc.data().systemSettings : undefined,
      systemMessages: configDoc.exists() ? configDoc.data().systemMessages : undefined,
    };
  } catch (e) {
    console.error('Error reading from Firestore, using file backup:', e);
    return null;
  }
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Database file path
const DB_FILE = path.join(process.cwd(), 'data-store.json');

const DEFAULT_SUPERADMIN_EMAIL = 'superadmin@docflowpro.com';
const DEFAULT_SUPERADMIN_PASSWORD_HASH = hashPassword('superadmin123');

function ensureSuperadmin(state: AppDataState) {
  if (!state.users) state.users = [];
  let superadmin = state.users.find(u => u.email.toLowerCase() === DEFAULT_SUPERADMIN_EMAIL.toLowerCase());
  if (!superadmin) {
    superadmin = {
      id: 'usr-superadmin',
      name: 'Super',
      lastName: 'Admin',
      email: DEFAULT_SUPERADMIN_EMAIL,
      role: 'SUPERADMIN',
      phone: '+54 9 11 5555-0100',
      active: true,
      address: 'Sede Central',
      city: 'Buenos Aires',
      province: 'CABA',
      country: 'Argentina',
      passwordHash: DEFAULT_SUPERADMIN_PASSWORD_HASH,
      isVerified: true,
    };
    state.users.push(superadmin);
  } else {
    // Make sure it is verified and active
    superadmin.isVerified = true;
    superadmin.active = true;
    if (!superadmin.passwordHash) {
      superadmin.passwordHash = DEFAULT_SUPERADMIN_PASSWORD_HASH;
    }
  }
}

function cleanDummyData(state: AppDataState) {
  // Ensure we keep templates and clean dummy records
  ensureSuperadmin(state);
  
  // Clean users that are dummy (Lucia, Marcos, Sofía, Esteban unless they have dynamic password hashes or are superadmin)
  state.users = state.users.filter(u => u.email.toLowerCase() === DEFAULT_SUPERADMIN_EMAIL.toLowerCase() || u.passwordHash);

  // Clear dummy cases, documents, etc.
  state.cases = [];
  state.documents = [];
  state.tasks = [];
  state.observations = [];
  state.notifications = [];
  state.auditLogs = [];
  state.formSubmissions = [];
  state.activeIndustry = state.activeIndustry || 'Inmobiliaria';
  state.verificationPolicies = state.verificationPolicies || {
    ASESOR: 'email',
    MANAGER: 'email',
    ADMIN: 'email'
  };
  if (!state.systemSettings || !state.systemSettings.roleMessagingConfigs) {
    state.systemSettings = {
      roleMessagingConfigs: {
        SUPERADMIN: { allowed: true, rule: 'free' },
        ADMIN: { allowed: true, rule: 'free' },
        MANAGER: { allowed: true, rule: 'free' },
        ASESOR: { allowed: true, rule: 'free' }
      }
    };
  }
  state.systemMessages = state.systemMessages || [];
}

// Initialize database from Firestore or file
function loadDB(): AppDataState {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const state = JSON.parse(raw);
      cleanDummyData(state);
      return state;
    }
  } catch (err) {
    console.error('Error reading database file:', err);
  }
  // Seeding initial state
  const state = { ...INITIAL_STATE };
  cleanDummyData(state);
  saveDB(state);
  return state;
}

function saveDB(state: AppDataState) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), 'utf-8');
    // Sync to Firestore asynchronously
    syncToFirestore(state);
  } catch (err) {
    console.error('Error writing to database file:', err);
  }
}

// Load DBState
let dbState = loadDB();

// Async startup to load from Firestore
async function initDbFromCloud() {
  const cloudState = await loadFromFirestore();
  if (cloudState) {
    console.log('Successfully hydrated state from Google Firestore.');
    if (cloudState.users) dbState.users = cloudState.users;
    if (cloudState.templates) dbState.templates = cloudState.templates;
    if (cloudState.cases) dbState.cases = cloudState.cases;
    if (cloudState.documents) dbState.documents = cloudState.documents;
    if (cloudState.tasks) dbState.tasks = cloudState.tasks;
    if (cloudState.observations) dbState.observations = cloudState.observations;
    if (cloudState.notifications) dbState.notifications = cloudState.notifications;
    if (cloudState.auditLogs) dbState.auditLogs = cloudState.auditLogs;
    if (cloudState.formSubmissions) dbState.formSubmissions = cloudState.formSubmissions;
    if (cloudState.activeIndustry) dbState.activeIndustry = cloudState.activeIndustry;
    if (cloudState.verificationPolicies) dbState.verificationPolicies = cloudState.verificationPolicies;
    if (cloudState.systemSettings) dbState.systemSettings = cloudState.systemSettings;
    if (cloudState.systemMessages) dbState.systemMessages = cloudState.systemMessages;
    
    cleanDummyData(dbState);
    fs.writeFileSync(DB_FILE, JSON.stringify(dbState, null, 2), 'utf-8');
  }
}
initDbFromCloud();

// Initialize Gemini Client safely
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey && apiKey !== 'MY_GEMINI_API_KEY') {
  try {
    ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    console.log('Gemini API initialized successfully.');
  } catch (e) {
    console.error('Error initializing Gemini client:', e);
  }
} else {
  console.log('Gemini API Key is not set or using placeholder. Running in fallback mode for AI features.');
}

// Helpers for auditing
function createAudit(userId: string, action: string, entityType: string, entityId: string, entityName: string) {
  const user = dbState.users.find(u => u.id === userId) || { name: 'Sistema', lastName: '', role: 'SYSTEM' };
  const log: AuditLog = {
    id: `log-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    userName: `${user.name} ${user.lastName}`.trim(),
    userRole: user.role,
    action,
    entityType,
    entityId,
    entityName,
    createdAt: new Date().toISOString()
  };
  dbState.auditLogs.unshift(log);
  saveDB(dbState);
  return log;
}

// Helper for notifying
function createNotification(userId: string, title: string, message: string, type: 'info' | 'success' | 'warning' | 'error', caseId?: string) {
  const notif: Notification = {
    id: `notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    title,
    message,
    type,
    read: false,
    createdAt: new Date().toISOString(),
    caseId
  };
  dbState.notifications.unshift(notif);
  saveDB(dbState);
  return notif;
}

// REST API Routes

app.get('/api/state', (req, res) => {
  res.json(dbState);
});

// 1. Auth & Users
app.get('/api/users', (req, res) => {
  // Return users without sensitive password hashes or verification tokens
  const safeUsers = dbState.users.map(u => {
    const { passwordHash, verificationToken, tokenCreatedAt, ...safeUser } = u as any;
    return safeUser;
  });
  res.json(safeUsers);
});

app.post('/api/auth/register', async (req, res) => {
  const { name, lastName, email, phone, address, city, province, country, password, role } = req.body;

  if (!name || !lastName || !email || !password || !role) {
    return res.status(400).json({ error: 'Faltan campos requeridos (nombre, apellido, email, contraseña, rol).' });
  }

  const existing = dbState.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (existing) {
    return res.status(400).json({ error: 'El correo electrónico ya está registrado.' });
  }

  const token = generateVerificationToken(6);
  const newUser: User = {
    id: `usr-${Date.now()}`,
    name,
    lastName,
    email: email.toLowerCase(),
    role: role.toUpperCase() as any,
    phone: phone || '',
    address: address || '',
    city: city || '',
    province: province || '',
    country: country || '',
    passwordHash: hashPassword(password),
    active: true,
    isVerified: false,
    verificationToken: token,
    tokenCreatedAt: new Date().toISOString(),
    avatar: `https://images.unsplash.com/photo-${Math.floor(1500000000000 + Math.random() * 100000000000)}?w=100&h=100&fit=crop&crop=faces`
  };

  dbState.users.push(newUser);
  saveDB(dbState);

  // Send real email via Resend
  await sendVerificationEmail(newUser.email, `${name} ${lastName}`, token);

  createAudit(newUser.id, 'Registro de usuario', 'User', newUser.id, `${name} ${lastName}`);

  const { passwordHash, verificationToken, tokenCreatedAt, ...safeUser } = newUser as any;
  res.status(201).json(safeUser);
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos.' });
  }

  const user = dbState.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  if (!user.active) {
    return res.status(403).json({ error: 'Tu cuenta ha sido desactivada por un administrador.' });
  }

  // If not verified, they must verify first
  if (user.isVerified === false) {
    return res.json({
      error: 'Debe verificar su cuenta con el código de seguridad enviado a su email.',
      requiresVerification: true,
      email: user.email
    });
  }

  const { passwordHash, verificationToken, tokenCreatedAt, ...safeUser } = user as any;
  res.json({ success: true, user: safeUser });
});

app.post('/api/auth/verify', (req, res) => {
  const { email, token } = req.body;
  if (!email || !token) {
    return res.status(400).json({ error: 'Email y código requeridos.' });
  }

  const user = dbState.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  if (user.isVerified) {
    return res.status(400).json({ error: 'La cuenta ya se encuentra verificada.' });
  }

  if (user.verificationToken !== token) {
    return res.status(400).json({ error: 'Código de verificación incorrecto.' });
  }

  // Mark as verified
  user.isVerified = true;
  user.verificationToken = undefined;
  user.tokenCreatedAt = undefined;
  saveDB(dbState);

  createAudit(user.id, 'Cuenta verificada con éxito', 'User', user.id, `${user.name} ${user.lastName}`);

  const { passwordHash, ...safeUser } = user as any;
  res.json({ success: true, user: safeUser });
});

app.post('/api/auth/resend-token', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email requerido.' });
  }

  const user = dbState.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  if (user.isVerified) {
    return res.status(400).json({ error: 'La cuenta ya se encuentra verificada.' });
  }

  // Check timestamp (30 mins = 1800000 ms)
  const now = Date.now();
  const createdTime = user.tokenCreatedAt ? new Date(user.tokenCreatedAt).getTime() : 0;
  const diff = now - createdTime;

  let token = user.verificationToken;
  let isNew = false;

  if (!token || diff >= 30 * 60 * 1000) {
    token = generateVerificationToken(6);
    user.verificationToken = token;
    user.tokenCreatedAt = new Date().toISOString();
    saveDB(dbState);
    isNew = true;
  }

  // Send email via Resend
  await sendVerificationEmail(user.email, `${user.name} ${user.lastName}`, token!);

  res.json({
    success: true,
    message: isNew ? 'Se generó y envió un nuevo código de verificación.' : 'Se reenvió el código de verificación existente.'
  });
});

app.post('/api/auth/update-profile', (req, res) => {
  const { userId, name, lastName, phone, address, city, province, country, password, avatar } = req.body;
  const user = dbState.users.find(u => u.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado' });
  }

  if (name !== undefined) user.name = name;
  if (lastName !== undefined) user.lastName = lastName;
  if (phone !== undefined) user.phone = phone;
  if (address !== undefined) user.address = address;
  if (city !== undefined) user.city = city;
  if (province !== undefined) user.province = province;
  if (country !== undefined) user.country = country;
  if (avatar !== undefined) user.avatar = avatar;
  
  if (password) {
    user.passwordHash = hashPassword(password);
  }

  saveDB(dbState);
  createAudit(user.id, 'Actualizó su perfil', 'User', user.id, `${user.name} ${user.lastName}`);
  
  const { passwordHash, verificationToken, ...safeUser } = user as any;
  res.json({ success: true, user: safeUser });
});

app.put('/api/users/:id', (req, res) => {
  const { id } = req.params;
  const { name, lastName, email, phone, role, active, address, city, province, country, password, currentUserId } = req.body;

  const targetUser = dbState.users.find(u => u.id === id);
  if (!targetUser) {
    return res.status(404).json({ error: 'Usuario destino no encontrado.' });
  }

  const currentUser = dbState.users.find(u => u.id === currentUserId);
  if (!currentUser) {
    return res.status(401).json({ error: 'No autorizado. Se requiere usuario actual.' });
  }

  // Permission Hierarchy Verification
  const isEditingSensitive = email !== undefined || password !== undefined || role !== undefined || active !== undefined;

  if (isEditingSensitive) {
    const actorRole = currentUser.role;
    const targetRole = targetUser.role;
    let allowed = false;

    if (actorRole === 'SUPERADMIN') {
      if (targetRole === 'ADMIN' || targetRole === 'SUPERADMIN' || targetRole === 'ASESOR') {
        allowed = true;
      }
    } else if (actorRole === 'ADMIN') {
      if (targetRole === 'MANAGER' || targetRole === 'ASESOR') {
        allowed = true;
      }
    } else if (actorRole === 'MANAGER') {
      if (targetRole === 'ASESOR') {
        allowed = true;
      }
    }

    if (!allowed) {
      return res.status(403).json({ error: 'No tienes permisos suficientes para modificar los datos sensibles de este usuario.' });
    }
  }

  if (name !== undefined) targetUser.name = name;
  if (lastName !== undefined) targetUser.lastName = lastName;
  if (phone !== undefined) targetUser.phone = phone;
  if (address !== undefined) targetUser.address = address;
  if (city !== undefined) targetUser.city = city;
  if (province !== undefined) targetUser.province = province;
  if (country !== undefined) targetUser.country = country;

  if (email !== undefined) targetUser.email = email.toLowerCase();
  if (role !== undefined) targetUser.role = role.toUpperCase() as any;
  if (active !== undefined) targetUser.active = active;
  if (password) {
    targetUser.passwordHash = hashPassword(password);
  }

  saveDB(dbState);
  createAudit(currentUser.id, `Modificó usuario ${targetUser.name} ${targetUser.lastName}`, 'User', targetUser.id, `${targetUser.name} ${targetUser.lastName}`);

  const { passwordHash, verificationToken, ...safeUser } = targetUser as any;
  res.json(safeUser);
});

app.post('/api/industry', (req, res) => {
  const { industry, currentUserId } = req.body;
  const currentUser = dbState.users.find(u => u.id === currentUserId);
  if (!currentUser || currentUser.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Solo el Superadmin puede decidir el rubro activo.' });
  }

  dbState.activeIndustry = industry;
  saveDB(dbState);
  createAudit(currentUser.id, `Cambió el rubro activo a "${industry}"`, 'Config', 'industry', industry);
  res.json({ success: true, activeIndustry: industry });
});

app.post('/api/verification-policy', (req, res) => {
  const { policies, currentUserId } = req.body;
  const currentUser = dbState.users.find(u => u.id === currentUserId);
  if (!currentUser || currentUser.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Solo el Superadmin puede decidir las políticas de verificación.' });
  }

  dbState.verificationPolicies = policies;
  saveDB(dbState);
  createAudit(currentUser.id, `Actualizó políticas de verificación de registro (MFA)`, 'Config', 'verificationPolicies', 'MFA config updated');
  res.json({ success: true, policies: dbState.verificationPolicies });
});

app.post('/api/system-settings', (req, res) => {
  const { settings, currentUserId } = req.body;
  const currentUser = dbState.users.find(u => u.id === currentUserId);
  if (!currentUser || currentUser.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Solo el Superadmin puede decidir las configuraciones de la plataforma.' });
  }

  dbState.systemSettings = {
    ...(dbState.systemSettings || {}),
    ...settings
  };
  saveDB(dbState);
  createAudit(currentUser.id, `Modificó configuraciones del sistema (MFA, mensajería, etc.)`, 'Config', 'systemSettings', 'Configuration updated');
  res.json({ success: true, settings: dbState.systemSettings });
});

app.post('/api/system-messages', (req, res) => {
  const { senderId, receiverId, subject, content, attachments } = req.body;
  const sender = dbState.users.find(u => u.id === senderId);
  const receiver = dbState.users.find(u => u.id === receiverId);
  
  if (!sender || !receiver) {
    return res.status(404).json({ error: 'Remitente o destinatario no encontrado.' });
  }

  // Enforce role permission based on systemSettings.roleMessagingConfigs
  const configs = dbState.systemSettings?.roleMessagingConfigs || {
    SUPERADMIN: { allowed: true, rule: 'free' },
    ADMIN: { allowed: true, rule: 'free' },
    MANAGER: { allowed: true, rule: 'free' },
    ASESOR: { allowed: true, rule: 'free' }
  };

  const senderConfig = (configs as any)[sender.role] || { allowed: true, rule: 'free' };
  
  if (!senderConfig.allowed) {
    return res.status(403).json({ error: `Tu rol (${sender.role}) no tiene permisos para enviar mensajes internos en el sistema.` });
  }

  // Enforce wait_reply rule if configured for this specific role
  if (senderConfig.rule === 'wait_reply') {
    if (!dbState.systemMessages) dbState.systemMessages = [];
    // Find the latest message exchanged between these two users (not deleted permanently)
    const lastExchanged = dbState.systemMessages
      .filter(m => {
        const matchesSenderReceiver = (m.senderId === senderId && m.receiverId === receiverId) || 
                                      (m.senderId === receiverId && m.receiverId === senderId);
        const isPermanentlyDeletedBySender = (m as any).permanentDeletedBySender;
        return matchesSenderReceiver && !isPermanentlyDeletedBySender;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (lastExchanged && lastExchanged.senderId === senderId) {
      return res.status(400).json({ 
        error: 'La política del sistema para tu rol te impide enviar otro mensaje hasta que recibas una respuesta a tu último mensaje.' 
      });
    }
  }

  const newMessage = {
    id: `msg-${Date.now()}`,
    senderId,
    senderName: `${sender.name} ${sender.lastName}`,
    senderRole: sender.role,
    receiverId,
    receiverName: `${receiver.name} ${receiver.lastName}`,
    receiverRole: receiver.role,
    subject: subject || '(Sin Asunto)',
    content,
    createdAt: new Date().toISOString(),
    read: false,
    deletedBySender: false,
    deletedByReceiver: false,
    attachments: attachments || []
  };

  if (!dbState.systemMessages) dbState.systemMessages = [];
  dbState.systemMessages.unshift(newMessage);
  saveDB(dbState);

  createAudit(senderId, `Envió un mensaje interno a ${receiver.name} ${receiver.lastName}`, 'Message', newMessage.id, subject);
  res.status(201).json({ success: true, message: newMessage });
});

app.post('/api/system-messages/read', (req, res) => {
  const { messageId } = req.body;
  if (!dbState.systemMessages) dbState.systemMessages = [];
  const msg = dbState.systemMessages.find(m => m.id === messageId);
  if (msg) {
    msg.read = true;
    saveDB(dbState);
  }
  res.json({ success: true });
});

app.post('/api/system-messages/trash', (req, res) => {
  const { messageId, userId, action } = req.body; // action: 'trash' | 'restore'
  if (!dbState.systemMessages) dbState.systemMessages = [];
  const msg = dbState.systemMessages.find(m => m.id === messageId);
  if (msg) {
    const isTrash = action === 'trash';
    if (msg.senderId === userId) {
      msg.deletedBySender = isTrash;
    }
    if (msg.receiverId === userId) {
      msg.deletedByReceiver = isTrash;
    }
    saveDB(dbState);
    return res.json({ success: true, message: msg });
  }
  res.status(404).json({ error: 'Mensaje no encontrado' });
});

app.post('/api/system-messages/delete-permanent', (req, res) => {
  const { messageId, userId } = req.body;
  if (!dbState.systemMessages) dbState.systemMessages = [];
  const index = dbState.systemMessages.findIndex(m => m.id === messageId);
  if (index !== -1) {
    const msg = dbState.systemMessages[index];
    if (msg.senderId === userId) {
      (msg as any).permanentDeletedBySender = true;
    }
    if (msg.receiverId === userId) {
      (msg as any).permanentDeletedByReceiver = true;
    }
    
    // If deleted permanently by both, or by the only participant concerned, remove it
    const delSender = msg.senderId === userId ? true : (msg as any).permanentDeletedBySender;
    const delReceiver = msg.receiverId === userId ? true : (msg as any).permanentDeletedByReceiver;
    
    if (delSender && delReceiver) {
      dbState.systemMessages.splice(index, 1);
    }
    saveDB(dbState);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Mensaje no encontrado' });
});

// 2. Templates
app.get('/api/templates', (req, res) => {
  res.json(dbState.templates);
});

app.post('/api/templates', (req, res) => {
  const { name, description, industry, stages } = req.body;
  const newTemplate: ProcessTemplate = {
    id: `tmpl-${Date.now()}`,
    name,
    description,
    industry,
    stages: stages || []
  };
  const creatorId = req.body.currentUserId || 'usr-system';
  dbState.templates.push(newTemplate);
  saveDB(dbState);
  createAudit(creatorId, 'Plantilla de proceso creada', 'ProcessTemplate', newTemplate.id, name);
  res.status(201).json(newTemplate);
});

app.put('/api/templates/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, industry, stages, currentUserId } = req.body;
  const templateIndex = dbState.templates.findIndex(t => t.id === id);
  if (templateIndex === -1) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada.' });
  }
  const updatedTemplate = {
    ...dbState.templates[templateIndex],
    name: name || dbState.templates[templateIndex].name,
    description: description !== undefined ? description : dbState.templates[templateIndex].description,
    industry: industry || dbState.templates[templateIndex].industry,
    stages: stages !== undefined ? stages : dbState.templates[templateIndex].stages
  };
  dbState.templates[templateIndex] = updatedTemplate;
  saveDB(dbState);
  createAudit(currentUserId || 'usr-system', 'Plantilla de proceso actualizada', 'ProcessTemplate', id, updatedTemplate.name);
  res.json(updatedTemplate);
});

// 3. Cases (Expedientes)
app.get('/api/cases', (req, res) => {
  res.json(dbState.cases);
});

app.post('/api/cases', (req, res) => {
  const { title, description, templateId, assignedAdvisorId, assignedManagerId, participants, currentUserId } = req.body;
  const template = dbState.templates.find(t => t.id === templateId);
  if (!template) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada' });
  }

  const caseId = `case-${Date.now()}`;
  const code = `EXP-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  
  // If no manager is specified, status is 'pending_assignment'
  const finalManagerId = assignedManagerId || '';
  const status = finalManagerId ? 'active' : 'pending_assignment';

  const newCase: Case = {
    id: caseId,
    code,
    title,
    description,
    status,
    templateId,
    currentStageIndex: 0,
    assignedAdvisorId: assignedAdvisorId || currentUserId || '',
    assignedManagerId: finalManagerId,
    participants: participants || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  dbState.cases.unshift(newCase);

  // Initialize stage tasks & empty documents placeholders
  const currentStage = template.stages[0];
  if (currentStage) {
    currentStage.requirements.forEach(reqObj => {
      if (reqObj.type === 'task') {
        dbState.tasks.push({
          id: `tsk-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
          caseId,
          stageId: currentStage.id,
          requirementId: reqObj.id,
          name: reqObj.name,
          description: reqObj.description,
          status: 'pending'
        });
      }
    });
  }

  const creatorId = currentUserId || assignedAdvisorId || 'usr-system';
  saveDB(dbState);
  createAudit(creatorId, status === 'pending_assignment' ? 'Solicitud de expediente creada' : 'Expediente creado', 'Case', caseId, title);
  
  if (assignedAdvisorId) {
    createNotification(assignedAdvisorId, 'Nuevo Expediente Creado', `Tu expediente ${code}: "${title}" fue registrado.`, 'info', caseId);
  }

  // If pending assignment, notify all managers
  if (status === 'pending_assignment') {
    dbState.users.forEach(u => {
      if (u.role === 'MANAGER' || u.role === 'ADMIN' || u.role === 'SUPERADMIN') {
        createNotification(u.id, 'Nueva Solicitud de Expediente', `El asesor solicita iniciar el expediente ${code}: "${title}". Disponible para asignar.`, 'warning', caseId);
      }
    });
  } else if (finalManagerId) {
    createNotification(finalManagerId, 'Expediente Asignado', `Se te asignó el expediente ${code}: "${title}".`, 'info', caseId);
  }

  res.status(201).json(newCase);
});

// Assign Manager dynamically to case
app.post('/api/cases/:id/assign-manager', (req, res) => {
  const { id } = req.params;
  const { managerId, currentUserId } = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Expediente no encontrado' });
  }

  const manager = dbState.users.find(u => u.id === managerId && u.role === 'MANAGER');
  if (!manager) {
    return res.status(400).json({ error: 'Usuario especificado no es un Manager válido.' });
  }

  const actor = dbState.users.find(u => u.id === currentUserId);
  if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN' && actor.role !== 'SUPERADMIN')) {
    return res.status(403).json({ error: 'No autorizado para asignar Managers.' });
  }

  caseObj.assignedManagerId = managerId;
  caseObj.status = 'active';
  caseObj.updatedAt = new Date().toISOString();

  saveDB(dbState);
  createAudit(currentUserId, `Asignó manager a expediente`, 'Case', id, caseObj.title);
  createNotification(caseObj.assignedAdvisorId, 'Manager Asignado', `El manager ${manager.name} ${manager.lastName} ha sido asignado a tu expediente.`, 'success', id);
  createNotification(managerId, 'Nuevo Expediente Asignado', `Has sido asignado al expediente ${caseObj.code}: "${caseObj.title}".`, 'info', id);

  res.json(caseObj);
});

// Update case basic details
app.put('/api/cases/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, assignedAdvisorId, status, participants } = req.body;
  
  const caseIdx = dbState.cases.findIndex(c => c.id === id);
  if (caseIdx === -1) {
    return res.status(404).json({ error: 'Expediente no encontrado' });
  }

  const oldCase = dbState.cases[caseIdx];
  const updatedCase = {
    ...oldCase,
    title: title || oldCase.title,
    description: description || oldCase.description,
    assignedAdvisorId: assignedAdvisorId || oldCase.assignedAdvisorId,
    status: status || oldCase.status,
    participants: participants || oldCase.participants,
    updatedAt: new Date().toISOString()
  };

  dbState.cases[caseIdx] = updatedCase;

  if (assignedAdvisorId && assignedAdvisorId !== oldCase.assignedAdvisorId) {
    createNotification(assignedAdvisorId, 'Expediente Reasignado', `Se te reasignó el expediente ${oldCase.code}: "${updatedCase.title}"`, 'info', id);
  }

  saveDB(dbState);
  const updaterId = req.body.currentUserId || 'usr-system';
  createAudit(updaterId, 'Expediente actualizado', 'Case', id, updatedCase.title);
  res.json(updatedCase);
});

// Add Participant dynamically to case
app.post('/api/cases/:id/participants', (req, res) => {
  const { id } = req.params;
  const participant = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Expediente no encontrado' });
  }

  if (!caseObj.participants) {
    caseObj.participants = [];
  }

  caseObj.participants.push({
    id: participant.id || `prt-${Date.now()}`,
    name: participant.name || '',
    lastName: participant.lastName || '',
    dni: participant.dni || '',
    cuitCuil: participant.cuitCuil || '',
    email: participant.email || '',
    phone: participant.phone || '',
    comments: participant.comments
  });

  caseObj.updatedAt = new Date().toISOString();
  saveDB(dbState);

  const creatorId = participant.currentUserId || 'usr-system';
  createAudit(creatorId, 'Participante añadido', 'Case', id, `${participant.name} ${participant.lastName}`);
  res.json(caseObj);
});

// STRICT Control de Avance validation helper
function validateStageRequirements(caseId: string, stageId: string, template: ProcessTemplate) {
  const stage = template.stages.find(s => s.id === stageId);
  if (!stage) return { isValid: false, reason: 'Etapa no válida' };

  // Fetch all documents for this case and stage
  const docs = dbState.documents.filter(d => d.caseId === caseId && d.stageId === stageId);
  // Fetch all tasks for this case and stage
  const tasks = dbState.tasks.filter(t => t.caseId === caseId && t.stageId === stageId);
  // Fetch all open observations for this case and stage
  const openObs = dbState.observations.filter(o => o.caseId === caseId && o.stageId === stageId && o.status === 'open');
  // Fetch form submissions
  const submissions = dbState.formSubmissions;

  const missingRequirements: string[] = [];

  for (const req of stage.requirements) {
    if (!req.isRequired) continue;

    if (req.type === 'document') {
      const doc = docs.find(d => d.requirementId === req.id);
      if (!doc || doc.status === 'pending') {
        missingRequirements.push(`Documento faltante: "${req.name}"`);
      } else if (doc.status === 'rejected') {
        missingRequirements.push(`Documento rechazado: "${req.name}" (Debe ser aprobado)`);
      } else if (doc.status === 'in_review' || doc.status === 'uploaded') {
        missingRequirements.push(`Documento en revisión: "${req.name}" (Requiere aprobación del Manager)`);
      }
    } else if (req.type === 'task') {
      const task = tasks.find(t => t.requirementId === req.id);
      if (!task || task.status !== 'completed') {
        missingRequirements.push(`Tarea pendiente: "${req.name}"`);
      }
    } else if (req.type === 'form') {
      const sub = submissions.find(s => s.requirementId === req.id);
      if (!sub) {
        missingRequirements.push(`Formulario pendiente: "${req.name}"`);
      }
    }
  }

  // Check for open observations
  if (openObs.length > 0) {
    missingRequirements.push(`Observación abierta: Hay ${openObs.length} observaciones pendientes de resolución.`);
  }

  return {
    isValid: missingRequirements.length === 0,
    missing: missingRequirements
  };
}

// 4. Advance Stage Endpoint (Control de Avance)
app.post('/api/cases/:id/advance', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Expediente no encontrado' });
  }

  const template = dbState.templates.find(t => t.id === caseObj.templateId);
  if (!template) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada' });
  }

  const currentStage = template.stages[caseObj.currentStageIndex];
  if (!currentStage) {
    return res.status(400).json({ error: 'Etapa actual no válida' });
  }

  // Validate all requirements
  const validation = validateStageRequirements(caseObj.id, currentStage.id, template);
  if (!validation.isValid) {
    return res.status(400).json({
      error: 'Avance denegado automáticamente',
      reasons: validation.missing
    });
  }

  // Move to next stage
  const nextStageIndex = caseObj.currentStageIndex + 1;
  const isCompleted = nextStageIndex >= template.stages.length;

  caseObj.currentStageIndex = isCompleted ? caseObj.currentStageIndex : nextStageIndex;
  caseObj.status = isCompleted ? 'completed' : 'active';
  caseObj.updatedAt = new Date().toISOString();

  // If moving to a new stage, initialize tasks for that stage
  if (!isCompleted) {
    const nextStage = template.stages[nextStageIndex];
    nextStage.requirements.forEach(reqObj => {
      if (reqObj.type === 'task') {
        const alreadyExists = dbState.tasks.some(t => t.caseId === id && t.requirementId === reqObj.id);
        if (!alreadyExists) {
          dbState.tasks.push({
            id: `tsk-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            caseId: id,
            stageId: nextStage.id,
            requirementId: reqObj.id,
            name: reqObj.name,
            description: reqObj.description,
            status: 'pending'
          });
        }
      }
    });

    createNotification(
      caseObj.assignedAdvisorId,
      'Cambio de Etapa',
      `El expediente ${caseObj.code} avanzó a la etapa: "${nextStage.name}"`,
      'success',
      id
    );
    createAudit(userId, `Avanzó etapa a "${nextStage.name}"`, 'Case', id, caseObj.title);
  } else {
    createNotification(
      caseObj.assignedAdvisorId,
      'Expediente Finalizado',
      `Felicidades! El expediente ${caseObj.code} ha sido finalizado exitosamente.`,
      'success',
      id
    );
    createAudit(userId, 'Finalizó expediente', 'Case', id, caseObj.title);
  }

  saveDB(dbState);
  res.json({ success: true, case: caseObj });
});

// Check advancement status API (Dry run)
app.get('/api/cases/:id/validate', (req, res) => {
  const { id } = req.params;
  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Expediente no encontrado' });
  }
  const template = dbState.templates.find(t => t.id === caseObj.templateId);
  if (!template) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada' });
  }
  const currentStage = template.stages[caseObj.currentStageIndex];
  if (!currentStage) {
    return res.status(400).json({ error: 'Etapa actual no válida' });
  }

  const validation = validateStageRequirements(caseObj.id, currentStage.id, template);
  res.json(validation);
});

// 5. Document Management
app.get('/api/cases/:caseId/documents', (req, res) => {
  const { caseId } = req.params;
  res.json(dbState.documents.filter(d => d.caseId === caseId));
});

// Advisor Uploads/Replaces Document
app.post(['/api/documents', '/api/documents/upload'], (req, res) => {
  const { caseId, stageId, requirementId, name, fileName, fileSize, uploadedBy } = req.body;

  // Resolve requirement name from template if not provided by frontend
  let resolvedName = name;
  if (!resolvedName && requirementId) {
    const template = dbState.templates.find(t => t.stages.some(s => s.requirements.some(r => r.id === requirementId)));
    const reqObj = template?.stages.flatMap(s => s.requirements).find(r => r.id === requirementId);
    resolvedName = reqObj?.name || fileName || 'Documento';
  } else if (!resolvedName) {
    resolvedName = fileName || 'Documento';
  }

  const finalUploadedBy = uploadedBy || 'usr-asesor1';

  let doc = dbState.documents.find(d => d.caseId === caseId && d.requirementId === requirementId);
  const version = {
    fileName: fileName || 'document.pdf',
    fileSize: fileSize || 102400,
    uploadedBy: finalUploadedBy,
    uploadedAt: new Date().toISOString()
  };

  if (doc) {
    // Replaced/updated
    doc.status = 'uploaded'; // En revisión
    doc.fileName = fileName || doc.fileName;
    doc.fileSize = fileSize || doc.fileSize;
    doc.uploadedBy = finalUploadedBy;
    doc.uploadedAt = new Date().toISOString();
    doc.versions.push(version);
  } else {
    // New document uploaded
    doc = {
      id: `doc-${Date.now()}`,
      caseId,
      stageId,
      requirementId,
      name: resolvedName,
      status: 'uploaded', // En revisión
      fileName: fileName || 'document.pdf',
      fileSize: fileSize || 102400,
      uploadedBy: finalUploadedBy,
      uploadedAt: new Date().toISOString(),
      versions: [version]
    };
    dbState.documents.push(doc);
  }

  // Update Case status to pending review if not observed
  const caseObj = dbState.cases.find(c => c.id === caseId);
  if (caseObj && caseObj.status !== 'observed') {
    caseObj.status = 'pending_review';
    caseObj.updatedAt = new Date().toISOString();
  }

  saveDB(dbState);
  createAudit(finalUploadedBy, `Cargó documento "${resolvedName}"`, 'Document', doc.id, resolvedName);
  
  // Notify Manager
  if (caseObj) {
    createNotification(
      caseObj.assignedManagerId,
      'Documento para Revisar',
      `El asesor cargó "${resolvedName}" en el expediente ${caseObj.code}`,
      'info',
      caseId
    );
  }

  res.status(201).json(doc);
});

// Manager Approves or Rejects Document
app.all('/api/documents/:id/review', (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { id } = req.params;
  const { status, observationText, userId, reviewedBy } = req.body; // status: 'approved' | 'rejected'
  const finalUserId = userId || reviewedBy || 'usr-manager1';

  const doc = dbState.documents.find(d => d.id === id);
  if (!doc) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }

  const caseObj = dbState.cases.find(c => c.id === doc.caseId);

  doc.status = status;
  saveDB(dbState);

  createAudit(finalUserId, `Documento ${status === 'approved' ? 'aprobado' : 'rechazado'}: "${doc.name}"`, 'Document', doc.id, doc.name);

  if (status === 'rejected') {
    // Create observation
    const obs: Observation = {
      id: `obs-${Date.now()}`,
      caseId: doc.caseId,
      stageId: doc.stageId,
      requirementId: doc.requirementId,
      documentId: doc.id,
      text: observationText || 'Documento rechazado por el gestor. Favor de verificar.',
      createdBy: finalUserId,
      createdAt: new Date().toISOString(),
      status: 'open'
    };
    dbState.observations.unshift(obs);
    
    if (caseObj) {
      caseObj.status = 'observed';
      caseObj.updatedAt = new Date().toISOString();
      createNotification(
        caseObj.assignedAdvisorId,
        'Documento Rechazado',
        `Tu documento "${doc.name}" en ${caseObj.code} fue rechazado. Motivo: ${obs.text}`,
        'error',
        doc.caseId
      );
    }
  } else {
    // If approved, check if there are other observed/uploaded documents to decide case status
    if (caseObj) {
      const caseDocs = dbState.documents.filter(d => d.caseId === caseObj.id && d.stageId === doc.stageId);
      const hasObserved = caseDocs.some(d => d.status === 'rejected') || dbState.observations.some(o => o.caseId === caseObj.id && o.stageId === doc.stageId && o.status === 'open');
      const hasPendingReview = caseDocs.some(d => d.status === 'uploaded');

      if (hasObserved) {
        caseObj.status = 'observed';
      } else if (hasPendingReview) {
        caseObj.status = 'pending_review';
      } else {
        caseObj.status = 'active';
      }
      caseObj.updatedAt = new Date().toISOString();

      createNotification(
        caseObj.assignedAdvisorId,
        'Documento Aprobado',
        `Excelente! Tu documento "${doc.name}" en ${caseObj.code} fue aprobado.`,
        'success',
        doc.caseId
      );
    }
  }

  saveDB(dbState);
  res.json({ doc, case: caseObj });
});

// 6. Tasks
app.get('/api/cases/:caseId/tasks', (req, res) => {
  const { caseId } = req.params;
  res.json(dbState.tasks.filter(t => t.caseId === caseId));
});

app.all(['/api/tasks/:id', '/api/tasks/:id/toggle'], (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { id } = req.params;
  const { status, userId, completedBy } = req.body; // status: 'pending' | 'completed'
  const finalUserId = userId || completedBy || 'usr-asesor1';

  const task = dbState.tasks.find(t => t.id === id);
  if (!task) {
    return res.status(404).json({ error: 'Tarea no encontrada' });
  }

  task.status = status;
  if (status === 'completed') {
    task.completedBy = finalUserId;
    task.completedAt = new Date().toISOString();
  } else {
    task.completedBy = undefined;
    task.completedAt = undefined;
  }

  saveDB(dbState);
  createAudit(finalUserId, `Tarea marcada como ${status === 'completed' ? 'completa' : 'pendiente'}: "${task.name}"`, 'Task', task.id, task.name);
  res.json(task);
});

// 7. Observations
app.get('/api/cases/:caseId/observations', (req, res) => {
  const { caseId } = req.params;
  res.json(dbState.observations.filter(o => o.caseId === caseId));
});

// Create observational comment directly
app.post('/api/observations', (req, res) => {
  const { caseId, stageId, text, createdBy, requirementId } = req.body;
  const obs: Observation = {
    id: `obs-${Date.now()}`,
    caseId,
    stageId,
    text,
    createdBy,
    createdAt: new Date().toISOString(),
    status: 'open',
    requirementId
  };
  dbState.observations.unshift(obs);

  const caseObj = dbState.cases.find(c => c.id === caseId);
  if (caseObj) {
    caseObj.status = 'observed';
    caseObj.updatedAt = new Date().toISOString();
    createNotification(
      caseObj.assignedAdvisorId,
      'Nueva Observación',
      `Se agregó una observación en el expediente ${caseObj.code}: "${text}"`,
      'warning',
      caseId
    );
  }

  saveDB(dbState);
  createAudit(createdBy, 'Observación agregada', 'Observation', obs.id, text.substring(0, 30) + '...');
  res.status(201).json(obs);
});

// Advisor replies / resolves observation
app.all('/api/observations/:id/resolve', (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { id } = req.params;
  const { response, userId } = req.body;
  const finalUserId = userId || 'usr-asesor1';

  const obs = dbState.observations.find(o => o.id === id);
  if (!obs) {
    return res.status(404).json({ error: 'Observación no encontrada' });
  }

  obs.status = 'resolved';
  obs.response = response;
  obs.resolvedBy = finalUserId;
  obs.resolvedAt = new Date().toISOString();

  // If a document was associated, reset doc review state
  if (obs.documentId) {
    const doc = dbState.documents.find(d => d.id === obs.documentId);
    if (doc && doc.status === 'rejected') {
      doc.status = 'uploaded'; // back to uploaded/in review!
    }
  }

  // Check if case can return to active or pending review
  const caseObj = dbState.cases.find(c => c.id === obs.caseId);
  if (caseObj) {
    const hasOpenObs = dbState.observations.some(o => o.caseId === caseObj.id && o.stageId === obs.stageId && o.status === 'open');
    const hasRejectedDocs = dbState.documents.some(d => d.caseId === caseObj.id && d.stageId === obs.stageId && d.status === 'rejected');
    const hasUploadedDocs = dbState.documents.some(d => d.caseId === caseObj.id && d.stageId === obs.stageId && d.status === 'uploaded');

    if (hasOpenObs || hasRejectedDocs) {
      caseObj.status = 'observed';
    } else if (hasUploadedDocs) {
      caseObj.status = 'pending_review';
    } else {
      caseObj.status = 'active';
    }
    caseObj.updatedAt = new Date().toISOString();

    createNotification(
      caseObj.assignedManagerId,
      'Observación Respondida',
      `El asesor respondió a la observación en ${caseObj.code}`,
      'success',
      obs.caseId
    );
  }

  saveDB(dbState);
  createAudit(finalUserId, 'Observación resuelta', 'Observation', obs.id, obs.text.substring(0, 30) + '...');
  res.json({ obs, case: caseObj });
});

// 8. Form submissions
app.post('/api/forms/submit', (req, res) => {
  const { requirementId, values, submittedBy } = req.body;

  const existingIdx = dbState.formSubmissions.findIndex(f => f.requirementId === requirementId);
  const dataValue = {
    requirementId,
    values,
    submittedBy,
    submittedAt: new Date().toISOString()
  };

  if (existingIdx !== -1) {
    dbState.formSubmissions[existingIdx] = dataValue;
  } else {
    dbState.formSubmissions.push(dataValue);
  }

  saveDB(dbState);
  createAudit(submittedBy, 'Formulario guardado', 'Form', requirementId, `Valores guardados`);
  res.json(dataValue);
});

app.get('/api/forms/:requirementId', (req, res) => {
  const { requirementId } = req.params;
  const sub = dbState.formSubmissions.find(f => f.requirementId === requirementId);
  res.json(sub || null);
});

// 9. Notifications
app.get('/api/notifications', (req, res) => {
  res.json(dbState.notifications);
});

app.all('/api/notifications/:id/read', (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { id } = req.params;
  const notif = dbState.notifications.find(n => n.id === id);
  if (notif) {
    notif.read = true;
    saveDB(dbState);
  }
  res.json(notif);
});

app.delete('/api/notifications/:id', (req, res) => {
  const { id } = req.params;
  dbState.notifications = dbState.notifications.filter(n => n.id !== id);
  saveDB(dbState);
  res.json({ success: true });
});

app.all('/api/notifications/read-all', (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { userId } = req.body;
  dbState.notifications.forEach(n => {
    if (n.userId === userId) n.read = true;
  });
  saveDB(dbState);
  res.json({ success: true });
});

// 10. Audit Logs
app.get('/api/audit-logs', (req, res) => {
  res.json(dbState.auditLogs);
});


// SECURE AI INTEGRATION ENDPOINTS WITH GEMINI

// AI Document Compliance Audit Simulation
app.post('/api/gemini/analyze-document', async (req, res) => {
  const { documentId, requirementName, requirementDescription, fileName, uploadedBy } = req.body;

  const doc = dbState.documents.find(d => d.id === documentId);
  if (!doc) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }

  if (!ai) {
    // Gemini API Fallback (Randomly approve or reject with standard messages if API key is not set)
    console.log('Gemini API key not found. Executing fallback local compliance audit.');
    const isApproved = Math.random() > 0.35; // 65% approval rate
    
    setTimeout(() => {
      if (isApproved) {
        doc.status = 'approved';
        createAudit('usr-super', 'Auditoría IA: Documento aprobado', 'Document', doc.id, doc.name);
        
        const caseObj = dbState.cases.find(c => c.id === doc.caseId);
        if (caseObj) {
          caseObj.status = 'active';
          caseObj.updatedAt = new Date().toISOString();
          createNotification(
            doc.uploadedBy || 'usr-asesor1',
            'IA Auditoría: Aprobado',
            `La inteligencia artificial auditó y aprobó con éxito tu documento "${doc.name}" en el expediente ${caseObj.code}.`,
            'success',
            doc.caseId
          );
        }
        saveDB(dbState);
        return res.json({
          success: true,
          approved: true,
          analysis: `### INFORME DE COMPLIANCE DE INTELIGENCIA ARTIFICIAL (MOCK MODE)\n\n**Documento:** ${fileName}\n**Requisito:** ${requirementName}\n\n**Análisis:**\n1. **Verificación de Formato:** El archivo ${fileName} coincide con el formato PDF esperado.\n2. **Lectura Óptica de Caracteres (OCR):** Se detectan firmas completas, sellos notariales legibles y nombres coincidentes con las partes involucradas.\n3. **Verificación de Vigencia:** Las fechas mencionadas están dentro del marco legal vigente de 2026.\n\n**Resultado:** CUMPLIMIENTO EXITOSO. El gestor aprueba automáticamente. No se requiere acción adicional.`
        });
      } else {
        doc.status = 'rejected';
        const obsText = `IA Observación: El documento '${fileName}' cargado para '${requirementName}' carece de las firmas del co-propietario o la certificación del folio trasero. Re-escanear e integrar todos los folios.`;
        
        const obs: Observation = {
          id: `obs-ia-${Date.now()}`,
          caseId: doc.caseId,
          stageId: doc.stageId,
          requirementId: doc.requirementId,
          documentId: doc.id,
          text: obsText,
          createdBy: 'usr-super', // AI Auditor User
          createdAt: new Date().toISOString(),
          status: 'open'
        };
        dbState.observations.unshift(obs);

        const caseObj = dbState.cases.find(c => c.id === doc.caseId);
        if (caseObj) {
          caseObj.status = 'observed';
          caseObj.updatedAt = new Date().toISOString();
          createNotification(
            doc.uploadedBy || 'usr-asesor1',
            'IA Auditoría: Observado',
            `La IA auditó y observó tu documento "${doc.name}" en ${caseObj.code}. Motivo: ${obsText}`,
            'error',
            doc.caseId
          );
        }
        saveDB(dbState);
        return res.json({
          success: true,
          approved: false,
          analysis: `### INFORME DE COMPLIANCE DE INTELIGENCIA ARTIFICIAL (MOCK MODE)\n\n**Documento:** ${fileName}\n**Requisito:** ${requirementName}\n\n**Análisis:**\nSe detectaron discrepancias de firmas en el escaneo.\n\n**Resultado:** RECHAZADO. Se requiere un nuevo escaneo con firmas completas.`,
          suggestedObservation: obsText
        });
      }
    }, 1200);
    return;
  }

  try {
    const prompt = `Analiza la carga simulada del siguiente documento para certificar cumplimiento de normativas contractuales.
Requisito a auditar: "${requirementName}"
Descripción del requisito: "${requirementDescription}"
Nombre de archivo subido: "${fileName}"

Por favor, genera un análisis técnico formal e inteligente en formato JSON. Decide de manera realista si se aprueba ("approved": true) o se rechaza ("approved": false, con una observación descriptiva que el asesor deba solucionar). Dale un toque altamente profesional y estricto.

Retorna UNICAMENTE un objeto JSON estructurado así (sin markdown de código de envoltura adicional, solo el JSON puro):
{
  "approved": boolean,
  "analysis": "texto explicativo en markdown de los puntos auditados, vigencias, firmas y sellos",
  "suggestedObservation": "observación concisa en caso de que approved sea false"
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
      }
    });

    const resultText = response.text || '{}';
    const result = JSON.parse(resultText);

    if (result.approved) {
      doc.status = 'approved';
      createAudit('usr-super', 'Auditoría IA: Aprobado con Gemini', 'Document', doc.id, doc.name);
    } else {
      doc.status = 'rejected';
      const obsText = result.suggestedObservation || `Observación de IA para el requisito ${requirementName}`;
      const obs: Observation = {
        id: `obs-ia-${Date.now()}`,
        caseId: doc.caseId,
        stageId: doc.stageId,
        requirementId: doc.requirementId,
        documentId: doc.id,
        text: obsText,
        createdBy: 'usr-super', // AI Auditor
        createdAt: new Date().toISOString(),
        status: 'open'
      };
      dbState.observations.unshift(obs);
      createAudit('usr-super', 'Auditoría IA: Rechazado con Gemini', 'Document', doc.id, doc.name);
    }

    const caseObj = dbState.cases.find(c => c.id === doc.caseId);
    if (caseObj) {
      if (result.approved) {
        caseObj.status = 'active';
        createNotification(
          doc.uploadedBy || 'usr-asesor1',
          'IA Auditoría: Aprobado',
          `La IA de Gemini auditó y aprobó con éxito tu documento "${doc.name}" en el expediente ${caseObj.code}.`,
          'success',
          doc.caseId
        );
      } else {
        caseObj.status = 'observed';
        createNotification(
          doc.uploadedBy || 'usr-asesor1',
          'IA Auditoría: Observado',
          `Gemini auditó y observó tu documento "${doc.name}" en ${caseObj.code}.`,
          'error',
          doc.caseId
        );
      }
      caseObj.updatedAt = new Date().toISOString();
    }

    saveDB(dbState);
    res.json({ success: true, ...result });

  } catch (err: any) {
    console.error('Error in Gemini Document Audit:', err);
    res.status(500).json({ error: 'Error procesando auditoría de IA', details: err.message });
  }
});

// AI Process Template Generation
app.post('/api/gemini/generate-template', async (req, res) => {
  const { industry, promptDescription } = req.body;

  if (!ai) {
    // Fallback template builder if no key
    const newTmpl: ProcessTemplate = {
      id: `tmpl-${Date.now()}`,
      name: `Proceso IA: ${promptDescription.substring(0, 30)}...`,
      description: `Proceso auto-generado para el rubro ${industry}. Basado en la descripción: ${promptDescription}`,
      industry: industry || 'Inmobiliaria',
      stages: [
        {
          id: `stg-ia-1-${Date.now()}`,
          name: '1. Recolección de Datos Iniciales',
          description: 'Cargar la información básica del cliente y el proceso.',
          requirements: [
            { id: `req-ia-1-doc-${Date.now()}`, name: 'Documento de Identidad (DNI/CUIT)', type: 'document', description: 'Copia digital legible del documento de identidad.', isRequired: true },
            { id: `req-ia-1-frm-${Date.now()}`, name: 'Formulario de Datos Personales', type: 'form', description: 'Completar datos de contacto y antecedentes.', isRequired: true, formFields: [
                { id: 'f-ia-name', label: 'Nombre Completo', type: 'text', required: true },
                { id: 'f-ia-email', label: 'Email', type: 'text', required: true }
              ] 
            }
          ]
        },
        {
          id: `stg-ia-2-${Date.now()}`,
          name: '2. Evaluación y Firma',
          description: 'Revisión final de cumplimiento, checklist técnico y firma de actas.',
          requirements: [
            { id: `req-ia-2-tsk-${Date.now()}`, name: 'Revisión de carpetas técnicas', type: 'task', description: 'Revisar antecedentes en el sistema y validar firmas.', isRequired: true },
            { id: `req-ia-2-doc-${Date.now()}`, name: 'Contrato o Acuerdo de Partes', type: 'document', description: 'Contrato escaneado con firma de los participantes.', isRequired: true }
          ]
        }
      ]
    };
    dbState.templates.push(newTmpl);
    saveDB(dbState);
    createAudit('usr-admin', 'Plantilla IA Creada (Offline Fallback)', 'ProcessTemplate', newTmpl.id, newTmpl.name);
    return res.json({ success: true, template: newTmpl });
  }

  try {
    const prompt = `Actúa como un Ingeniero de Procesos experto en el rubro: "${industry}".
Un cliente requiere una plantilla de proceso automatizado reutilizable basada en la siguiente descripción: "${promptDescription}".

Genera una estructura de plantilla completa de 2 a 4 etapas coherentes y realistas para este rubro. Cada etapa debe contener de 2 a 3 requisitos obligatorios distribuidos racionalmente entre "document" (carga de PDF/foto), "form" (campos interactivos para rellenar) y "task" (tareas operacionales con casilla de verificación). Para los requisitos de tipo "form", define una lista de 'formFields' estructurados.

Retorna UNICAMENTE un objeto JSON que se ajuste al siguiente esquema de Typescript de manera estricta y sin markdown de código (solo el JSON puro para parsear directamente):

interface ProcessTemplate {
  name: string; // Título formal del proceso
  description: string; // Descripción detallada de los alcances
  industry: "Inmobiliaria" | "Jurídico" | "Seguros" | "Financiera" | "Recursos Humanos" | "Administrativo";
  stages: {
    id: string; // id único corto p.ej. "stg-1", "stg-2"
    name: string; // Nombre formal de la etapa
    description: string; // Qué se debe lograr en la etapa
    requirements: {
      id: string; // id único corto p.ej. "req-1", "req-2"
      name: string; // Título del requisito
      type: "document" | "form" | "task";
      description: string; // Instrucciones del requisito para el asesor
      isRequired: boolean;
      formFields?: {
        id: string; // clave del campo
        label: string; // etiqueta visible
        type: "text" | "number" | "date" | "select" | "boolean";
        required: boolean;
        options?: string[]; // sólo si type es "select"
      }[];
    }[];
  }[];
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsedTemplate = JSON.parse(response.text || '{}');
    
    // Add stable IDs
    const finalTemplate: ProcessTemplate = {
      id: `tmpl-ia-${Date.now()}`,
      name: parsedTemplate.name || `Proceso IA - ${industry}`,
      description: parsedTemplate.description || `Proceso generado mediante Inteligencia Artificial.`,
      industry: parsedTemplate.industry || industry || 'Administrativo',
      stages: (parsedTemplate.stages || []).map((stg: any, sIdx: number) => ({
        id: `stg-ia-${sIdx}-${Date.now()}`,
        name: stg.name,
        description: stg.description,
        requirements: (stg.requirements || []).map((req: any, rIdx: number) => ({
          id: `req-ia-${sIdx}-${rIdx}-${Date.now()}`,
          name: req.name,
          type: req.type,
          description: req.description,
          isRequired: req.isRequired !== undefined ? req.isRequired : true,
          formFields: req.formFields
        }))
      }))
    };

    dbState.templates.push(finalTemplate);
    saveDB(dbState);
    createAudit('usr-admin', 'Plantilla IA Creada con Gemini', 'ProcessTemplate', finalTemplate.id, finalTemplate.name);

    res.json({ success: true, template: finalTemplate });
  } catch (err: any) {
    console.error('Error in Gemini Template Generation:', err);
    res.status(500).json({ error: 'Error generando plantilla inteligente', details: err.message });
  }
});


// Serve Frontend static files or Vite middleware
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite developer server middleware mounted on Express.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Serving production static build from: ', distPath);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Express server listening on http://localhost:${PORT}`);
  });
}

startServer();
