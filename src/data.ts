import { AppDataState, ProcessTemplate, User, Case } from './types';

const encodeBase64 = (str: string) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str).toString('base64');
  }
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(str)));
  }
  return '';
};

export const PRESET_AVATARS = [
  {
    name: 'Fantasmita',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#6366f1" rx="50"/><path d="M30,70 C30,40 35,30 50,30 C65,30 70,40 70,70 C70,72 65,75 60,70 C55,65 50,75 45,70 C40,65 35,75 30,70 Z" fill="#ffffff" /><circle cx="43" cy="48" r="4" fill="#1e1b4b" /><circle cx="57" cy="48" r="4" fill="#1e1b4b" /><circle cx="39" cy="53" r="2" fill="#f43f5e" opacity="0.6" /><circle cx="61" cy="53" r="2" fill="#f43f5e" opacity="0.6" /></svg>')
  },
  {
    name: 'Cactus',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#10b981" rx="50"/><path d="M35,75 L65,75 L60,85 L40,85 Z" fill="#f97316" /><rect x="32" y="70" width="36" height="6" rx="2" fill="#ea580c" /><rect x="44" y="30" width="12" height="42" rx="6" fill="#047857" /><path d="M44,45 L36,45 C34,45 34,55 36,55 L44,55" fill="none" stroke="#047857" stroke-width="8" stroke-linecap="round" /><path d="M56,38 L64,38 C66,38 66,48 64,48 L56,48" fill="none" stroke="#047857" stroke-width="8" stroke-linecap="round" /><circle cx="47" cy="42" r="2" fill="#ffffff" /><circle cx="53" cy="42" r="2" fill="#ffffff" /><path d="M48,46 Q50,48 52,46" stroke="#ffffff" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>')
  },
  {
    name: 'Pinguinito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#3b82f6" rx="50"/><ellipse cx="50" cy="55" rx="22" ry="25" fill="#1e293b" /><ellipse cx="50" cy="58" rx="15" ry="18" fill="#ffffff" /><ellipse cx="26" cy="55" rx="5" ry="12" fill="#1e293b" transform="rotate(-15 26 55)" /><ellipse cx="74" cy="55" rx="5" ry="12" fill="#1e293b" transform="rotate(15 74 55)" /><circle cx="44" cy="44" r="2.5" fill="#1e293b" /><circle cx="56" cy="44" r="2.5" fill="#1e293b" /><polygon points="46,47 54,47 50,53" fill="#f59e0b" /><ellipse cx="42" cy="80" rx="6" ry="3" fill="#f59e0b" /><ellipse cx="58" cy="80" rx="6" ry="3" fill="#f59e0b" /></svg>')
  },
  {
    name: 'Osito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f59e0b" rx="50"/><circle cx="32" cy="32" r="10" fill="#78350f" /><circle cx="32" cy="32" r="5" fill="#f43f5e" opacity="0.5" /><circle cx="68" cy="32" r="10" fill="#78350f" /><circle cx="68" cy="32" r="5" fill="#f43f5e" opacity="0.5" /><circle cx="50" cy="55" r="25" fill="#78350f" /><ellipse cx="50" cy="62" rx="10" ry="8" fill="#fef3c7" /><polygon points="47,58 53,58 50,62" fill="#1e293b" /><circle cx="42" cy="50" r="3" fill="#ffffff" /><circle cx="58" cy="50" r="3" fill="#ffffff" /></svg>')
  },
  {
    name: 'Gatito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#ec4899" rx="50"/><polygon points="25,25 45,45 25,50" fill="#f1f5f9" /><polygon points="75,25 55,45 75,50" fill="#f1f5f9" /><polygon points="28,29 40,41 28,45" fill="#fda4af" /><polygon points="72,29 60,41 72,45" fill="#fda4af" /><ellipse cx="50" cy="55" rx="26" ry="22" fill="#f1f5f9" /><circle cx="40" cy="52" r="3" fill="#0f172a" /><circle cx="60" cy="52" r="3" fill="#0f172a" /><polygon points="48,58 53,58 50,60" fill="#fda4af" /><path d="M47,62 Q50,64 50,62 Q50,64 53,62" stroke="#0f172a" stroke-width="1.5" fill="none" /><line x1="20" y1="54" x2="30" y2="56" stroke="#cbd5e1" stroke-width="2" /><line x1="20" y1="60" x2="29" y2="60" stroke="#cbd5e1" stroke-width="2" /><line x1="80" y1="54" x2="70" y2="56" stroke="#cbd5e1" stroke-width="2" /><line x1="80" y1="60" x2="71" y2="60" stroke="#cbd5e1" stroke-width="2" /></svg>')
  },
  {
    name: 'Robot',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#06b6d4" rx="50"/><line x1="50" y1="30" x2="50" y2="18" stroke="#f1f5f9" stroke-width="4" /><circle cx="50" cy="16" r="5" fill="#f43f5e" /><rect x="28" y="28" width="44" height="38" rx="8" fill="#cbd5e1" /><rect x="34" y="34" width="32" height="20" rx="4" fill="#1e293b" /><circle cx="44" cy="44" r="3" fill="#22c55e" /><circle cx="56" cy="44" r="3" fill="#22c55e" /><rect x="42" y="60" width="16" height="2" rx="1" fill="#475569" /><rect x="24" y="40" width="4" height="14" rx="2" fill="#475569" /><rect x="72" y="40" width="4" height="14" rx="2" fill="#475569" /></svg>')
  },
  {
    name: 'Zorrito',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f97316" rx="50"/><polygon points="20,25 42,42 18,50" fill="#ea580c" /><polygon points="80,25 58,42 82,50" fill="#ea580c" /><polygon points="23,28 36,39 22,44" fill="#1e293b" /><polygon points="77,28 64,39 78,44" fill="#1e293b" /><ellipse cx="36" cy="60" rx="16" ry="12" fill="#ffffff" /><ellipse cx="64" cy="60" rx="16" ry="12" fill="#ffffff" /><path d="M50,34 L28,52 C32,68 68,68 72,52 Z" fill="#ea580c" /><circle cx="38" cy="50" r="3" fill="#1e293b" /><circle cx="62" cy="50" r="3" fill="#1e293b" /><ellipse cx="50" cy="64" rx="5" ry="3.5" fill="#1e293b" /></svg>')
  },
  {
    name: 'Estrellita',
    url: 'data:image/svg+xml;base64,' + encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#8b5cf6" rx="50"/><path d="M50,18 L59,38 L81,41 L65,56 L69,78 L50,67 L31,78 L35,56 L19,41 L41,38 Z" fill="#fbbf24" /><circle cx="44" cy="48" r="2" fill="#1e293b" /><circle cx="56" cy="48" r="2" fill="#1e293b" /><path d="M47,53 Q50,56 53,53" stroke="#1e293b" stroke-width="1.5" fill="none" stroke-linecap="round" /><circle cx="41" cy="51" r="2" fill="#f43f5e" opacity="0.6" /><circle cx="59" cy="51" r="2" fill="#f43f5e" opacity="0.6" /></svg>')
  }
];

export const INITIAL_USERS: User[] = [
  {
    id: 'usr-super',
    name: 'Carlos',
    lastName: 'Gómez',
    email: 'super@gestion.com',
    role: 'SUPERADMIN',
    avatar: PRESET_AVATARS[0].url,
    phone: '+54 11 5555-0101',
    active: true
  },
  {
    id: 'usr-admin',
    name: 'Sofía',
    lastName: 'Rodriguez',
    email: 'admin@gestion.com',
    role: 'ADMIN',
    avatar: PRESET_AVATARS[1].url,
    phone: '+54 11 5555-0102',
    active: true
  },
  {
    id: 'usr-manager1',
    name: 'Esteban',
    lastName: 'Pérez',
    email: 'esteban@gestion.com',
    role: 'MANAGER',
    avatar: PRESET_AVATARS[2].url,
    phone: '+54 11 5555-0201',
    active: true
  },
  {
    id: 'usr-asesor1',
    name: 'Lucía',
    lastName: 'Fernández',
    email: 'lucia@gestion.com',
    role: 'ASESOR',
    avatar: PRESET_AVATARS[3].url,
    phone: '+54 11 5555-0301',
    active: true
  },
  {
    id: 'usr-asesor2',
    name: 'Marcos',
    lastName: 'Sanz',
    email: 'marcos@gestion.com',
    role: 'ASESOR',
    avatar: PRESET_AVATARS[4].url,
    phone: '+54 11 5555-0302',
    active: true
  }
];

export const INITIAL_TEMPLATES: ProcessTemplate[] = [];

export const INITIAL_STATE: AppDataState = {
  users: INITIAL_USERS,
  templates: INITIAL_TEMPLATES,
  cases: [
    {
      id: 'case-recoleta',
      code: 'EXP-2026-RECO',
      title: 'Compraventa - Depto Recoleta 3 Ambientes',
      description: 'Legajo para la venta del departamento ubicado en Av. Las Heras 2300, 4° Piso. Operación financiada.',
      status: 'observed',
      templateId: 'tmpl-venta',
      currentStageIndex: 1, // 'Estudio de Títulos'
      assignedAdvisorId: 'usr-asesor1', // Lucía
      assignedManagerId: 'usr-manager1', // Esteban
      participants: [
        {
          id: 'part-reco-comp',
          name: 'Roberto',
          lastName: 'Méndez',
          dni: '32.145.980',
          cuitCuil: '20-32145980-4',
          email: 'roberto.mendez@email.com',
          phone: '+54 11 4432-8761',
          comments: 'Comprador. Entrega 70% al Boleto y 30% a la escritura.'
        },
        {
          id: 'part-reco-vend',
          name: 'Clara',
          lastName: 'Sarmiento',
          dni: '25.845.112',
          cuitCuil: '27-25845112-9',
          email: 'clara.sarmiento@email.com',
          phone: '+54 11 6543-2101',
          comments: 'Vendedora. Titular registral única.'
        }
      ],
      createdAt: '2026-06-15T10:00:00Z',
      updatedAt: '2026-06-27T09:30:00Z'
    },
    {
      id: 'case-comercial',
      code: 'EXP-2026-PALE',
      title: 'Alquiler Comercial - Local Palermo Soho',
      description: 'Contrato de locación comercial del local en Honduras 4800 para indumentaria de diseño.',
      status: 'active',
      templateId: 'tmpl-alquiler',
      currentStageIndex: 0, // 'Requisitos de Admisión'
      assignedAdvisorId: 'usr-asesor2', // Marcos
      assignedManagerId: 'usr-manager1', // Esteban
      participants: [
        {
          id: 'part-pale-loc',
          name: 'Valentina',
          lastName: 'Guzmán',
          dni: '38.293.001',
          cuitCuil: '27-38293001-3',
          email: 'valen.guzman@email.com',
          phone: '+54 11 9876-5432',
          comments: 'Inquilina. Proveerá seguro de caución Finaer.'
        }
      ],
      createdAt: '2026-06-26T14:30:00Z',
      updatedAt: '2026-06-26T14:30:00Z'
    }
  ],
  documents: [
    // Case Recoleta documents (Stage 0 completed!)
    {
      id: 'doc-reco-reserva',
      caseId: 'case-recoleta',
      stageId: 'stg-v1',
      requirementId: 'req-v1-doc1',
      name: 'Reserva Firmada',
      status: 'approved',
      fileName: 'Reserva_LasHeras_Firmada.pdf',
      fileSize: 1245000,
      uploadedBy: 'usr-asesor1',
      uploadedAt: '2026-06-16T11:00:00Z',
      versions: [
        {
          fileName: 'Reserva_LasHeras_Firmada.pdf',
          fileSize: 1245000,
          uploadedBy: 'usr-asesor1',
          uploadedAt: '2026-06-16T11:00:00Z'
        }
      ]
    },
    // Stage 1 (observed!)
    {
      id: 'doc-reco-escritura',
      caseId: 'case-recoleta',
      stageId: 'stg-v2',
      requirementId: 'req-v2-doc1',
      name: 'Escritura de Propiedad Antecedente',
      status: 'rejected',
      fileName: 'Escritura_Anterior_LasHeras.pdf',
      fileSize: 4500100,
      uploadedBy: 'usr-asesor1',
      uploadedAt: '2026-06-20T15:20:00Z',
      versions: [
        {
          fileName: 'Escritura_Anterior_LasHeras.pdf',
          fileSize: 4500100,
          uploadedBy: 'usr-asesor1',
          uploadedAt: '2026-06-20T15:20:00Z'
        }
      ]
    },
    {
      id: 'doc-reco-plano',
      caseId: 'case-recoleta',
      stageId: 'stg-v2',
      requirementId: 'req-v2-doc2',
      name: 'Plano de Mensura Aprobado',
      status: 'uploaded', // En revisión
      fileName: 'Plano_Catastral_2024.pdf',
      fileSize: 2120000,
      uploadedBy: 'usr-asesor1',
      uploadedAt: '2026-06-25T17:40:00Z',
      versions: [
        {
          fileName: 'Plano_Catastral_2024.pdf',
          fileSize: 2120000,
          uploadedBy: 'usr-asesor1',
          uploadedAt: '2026-06-25T17:40:00Z'
        }
      ]
    }
  ],
  tasks: [
    // Case Recoleta
    {
      id: 'tsk-reco-credit',
      caseId: 'case-recoleta',
      stageId: 'stg-v1',
      requirementId: 'req-v1-tsk1',
      name: 'Verificación de Estado Crediticio',
      description: 'Verificar en bases comerciales que el comprador no posea inhibiciones.',
      status: 'completed',
      completedBy: 'usr-asesor1',
      completedAt: '2026-06-18T09:15:00Z'
    },
    {
      id: 'tsk-reco-catastro',
      caseId: 'case-recoleta',
      stageId: 'stg-v2',
      requirementId: 'req-v2-tsk1',
      name: 'Solicitud de Certificado Catastral',
      description: 'Generar la solicitud web ante la dirección provincial de catastro.',
      status: 'pending'
    }
  ],
  observations: [
    {
      id: 'obs-reco-escritura',
      caseId: 'case-recoleta',
      stageId: 'stg-v2',
      requirementId: 'req-v2-doc1',
      documentId: 'doc-reco-escritura',
      text: 'La copia está borrosa en las cláusulas de hipoteca anterior, especialmente no se lee bien el folio 3 del PDF. Favor de escanear de nuevo a mayor resolución.',
      createdBy: 'usr-manager1', // Esteban
      createdAt: '2026-06-22T10:00:00Z',
      status: 'open'
    }
  ],
  notifications: [
    {
      id: 'not-reco-obs',
      userId: 'usr-asesor1',
      title: 'Documento Rechazado',
      message: 'Tu documento "Escritura de Propiedad Antecedente" del legajo EXP-2026-RECO fue rechazado. Revisa las observaciones.',
      type: 'error',
      read: false,
      createdAt: '2026-06-22T10:01:00Z',
      caseId: 'case-recoleta'
    },
    {
      id: 'not-pale-new',
      userId: 'usr-asesor2',
      title: 'Nuevo Legajo Asignado',
      message: 'Se te ha asignado el legajo EXP-2026-PALE "Alquiler Comercial - Local Palermo Soho".',
      type: 'info',
      read: false,
      createdAt: '2026-06-26T14:31:00Z',
      caseId: 'case-comercial'
    }
  ],
  auditLogs: [
    {
      id: 'log-1',
      userId: 'usr-manager1',
      userName: 'Esteban Pérez',
      userRole: 'MANAGER',
      action: 'Legajo creado',
      entityType: 'Case',
      entityId: 'case-recoleta',
      entityName: 'Compraventa - Depto Recoleta 3 Ambientes',
      createdAt: '2026-06-15T10:00:00Z'
    },
    {
      id: 'log-2',
      userId: 'usr-asesor1',
      userName: 'Lucía Fernández',
      userRole: 'ASESOR',
      action: 'Documento cargado',
      entityType: 'Document',
      entityId: 'doc-reco-reserva',
      entityName: 'Reserva Firmada',
      createdAt: '2026-06-16T11:00:00Z'
    },
    {
      id: 'log-3',
      userId: 'usr-manager1',
      userName: 'Esteban Pérez',
      userRole: 'MANAGER',
      action: 'Documento aprobado',
      entityType: 'Document',
      entityId: 'doc-reco-reserva',
      entityName: 'Reserva Firmada',
      createdAt: '2026-06-18T16:45:00Z'
    },
    {
      id: 'log-4',
      userId: 'usr-asesor1',
      userName: 'Lucía Fernández',
      userRole: 'ASESOR',
      action: 'Formulario completado',
      entityType: 'Form',
      entityId: 'req-v1-form1',
      entityName: 'Formulario de Datos de Partes',
      createdAt: '2026-06-17T14:00:00Z'
    },
    {
      id: 'log-5',
      userId: 'usr-asesor1',
      userName: 'Lucía Fernández',
      userRole: 'ASESOR',
      action: 'Documento cargado',
      entityType: 'Document',
      entityId: 'doc-reco-escritura',
      entityName: 'Escritura de Propiedad Antecedente',
      createdAt: '2026-06-20T15:20:00Z'
    },
    {
      id: 'log-6',
      userId: 'usr-manager1',
      userName: 'Esteban Pérez',
      userRole: 'MANAGER',
      action: 'Documento rechazado',
      entityType: 'Document',
      entityId: 'doc-reco-escritura',
      entityName: 'Escritura de Propiedad Antecedente',
      createdAt: '2026-06-22T10:00:00Z'
    }
  ],
  formSubmissions: [
    {
      requirementId: 'req-v1-form1',
      values: {
        'f-comp-nombre': 'Roberto Méndez',
        'f-comp-dni': '32.145.980',
        'f-vend-nombre': 'Clara Sarmiento',
        'f-prop-valor': 145000,
        'f-escribano': 'Notaría de Juan Soria'
      },
      submittedBy: 'usr-asesor1',
      submittedAt: '2026-06-17T14:00:00Z'
    }
  ],
  verificationPolicies: {
    global: 'email',
    ASESOR: 'email',
    MANAGER: 'email',
    ADMIN: 'email'
  },
  systemSettings: {
    roleMessagingConfigs: {
      SUPERADMIN: { allowed: true, rule: 'free' },
      ADMIN: { allowed: true, rule: 'free' },
      MANAGER: { allowed: true, rule: 'free' },
      ASESOR: { allowed: true, rule: 'free' }
    }
  },
  systemMessages: [
    {
      id: 'msg-init-1',
      senderId: 'usr-super',
      senderName: 'Carlos Gómez',
      senderRole: 'SUPERADMIN',
      receiverId: 'usr-asesor1',
      receiverName: 'Lucía Fernández',
      receiverRole: 'ASESOR',
      subject: 'Bienvenida a DocFlow Pro',
      content: 'Hola Lucía, te doy la bienvenida al sistema de Gestión Documental. Por favor, revisa tus legajos asignados y no dudes en escribirme si tienes alguna consulta sobre los checklists.',
      createdAt: new Date(Date.now() - 3600000 * 24).toISOString(), // 1 day ago
      read: false
    }
  ],
  sharedDocuments: [
    {
      id: 'sh-doc-1',
      name: 'Manual de Procedimientos DocFlow',
      fileName: 'Manual_DocFlow_Pro.pdf',
      fileSize: 1024000,
      uploadedBy: 'Carlos Gómez (SUPERADMIN)',
      uploadedAt: '2026-06-25T11:00:00Z',
      allowedRoles: ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'],
      allowedUserIds: []
    }
  ],
  uploadRequests: []
};

