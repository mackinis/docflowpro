import { AppDataState, ProcessTemplate, User, Case } from './types';

export const INITIAL_USERS: User[] = [
  {
    id: 'usr-super',
    name: 'Carlos',
    lastName: 'Gómez',
    email: 'super@gestion.com',
    role: 'SUPERADMIN',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop&crop=faces',
    phone: '+54 11 5555-0101',
    active: true
  },
  {
    id: 'usr-admin',
    name: 'Sofía',
    lastName: 'Rodriguez',
    email: 'admin@gestion.com',
    role: 'ADMIN',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop&crop=faces',
    phone: '+54 11 5555-0102',
    active: true
  },
  {
    id: 'usr-manager1',
    name: 'Esteban',
    lastName: 'Pérez',
    email: 'esteban@gestion.com',
    role: 'MANAGER',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop&crop=faces',
    phone: '+54 11 5555-0201',
    active: true
  },
  {
    id: 'usr-asesor1',
    name: 'Lucía',
    lastName: 'Fernández',
    email: 'lucia@gestion.com',
    role: 'ASESOR',
    avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop&crop=faces',
    phone: '+54 11 5555-0301',
    active: true
  },
  {
    id: 'usr-asesor2',
    name: 'Marcos',
    lastName: 'Sanz',
    email: 'marcos@gestion.com',
    role: 'ASESOR',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=faces',
    phone: '+54 11 5555-0302',
    active: true
  }
];

export const INITIAL_TEMPLATES: ProcessTemplate[] = [
  {
    id: 'tmpl-venta',
    name: 'Venta Inmobiliaria Estándar',
    description: 'Proceso completo para la compraventa de propiedades inmuebles residenciales o comerciales.',
    industry: 'Inmobiliaria',
    originalDocumentContent: `CONTRATO DE RESERVA DE COMPRAVENTA INMOBILIARIA

En la Ciudad Autónoma de Buenos Aires, a los [Fecha] días del mes de [Mes] del año 2026, entre el Sr./Sra. [Nombre Completo Vendedor], DNI N° [DNI Vendedor], en adelante "EL VENDEDOR", y el Sr./Sra. [Nombre Completo Comprador], DNI N° [DNI Comprador], en adelante "EL COMPRADOR", se conviene celebrar el presente boleto de reserva ad-referendum de las siguientes cláusulas:

PRIMERA: EL COMPRADOR entrega en este acto la suma de [Monto de Reserva (USD)] Dólares Estadounidenses (USD) en concepto de RESERVA DE COMPRA para la adquisición de la propiedad inmueble sita en la calle Av. Las Heras 2300, 4° Piso, Recoleta.

SEGUNDA: La presente operación queda condicionada a la conformidad de EL VENDEDOR dentro del plazo de diez días hábiles, y a la aprobación del correspondiente Estudio de Títulos a cargo del Escribano Designado [Escribano Designado].

TERCERA: En caso de no aceptarse la reserva por parte de EL VENDEDOR, se restituirá la suma entregada de forma inmediata sin penalidad alguna para las partes. En caso de aceptación, las partes se obligan a la firma del boleto de compraventa definitivo dentro de los 30 días posteriores.

En prueba de conformidad, se firman dos ejemplares del mismo tenor y a un solo efecto.`,
    stages: [
      {
        id: 'stg-v1',
        name: 'Datos Iniciales y Reserva',
        description: 'Carga de datos básicos de las partes implicadas y firma de la reserva ad-referendum.',
        requirements: [
          {
            id: 'req-v1-doc1',
            name: 'Reserva Firmada',
            type: 'document',
            description: 'Documento de reserva firmado digital o físicamente por el comprador.',
            isRequired: true
          },
          {
            id: 'req-v1-form1',
            name: 'Formulario de Datos de Partes',
            type: 'form',
            description: 'Datos completos del comprador, vendedor y escribanía elegida.',
            isRequired: true,
            formFields: [
              { id: 'f-comp-nombre', label: 'Nombre Completo Comprador', type: 'text', required: true },
              { id: 'f-comp-dni', label: 'DNI Comprador', type: 'text', required: true },
              { id: 'f-vend-nombre', label: 'Nombre Completo Vendedor', type: 'text', required: true },
              { id: 'f-prop-valor', label: 'Monto de Reserva (USD)', type: 'number', required: true },
              { id: 'f-escribano', label: 'Escribano Designado', type: 'text', required: false }
            ]
          },
          {
            id: 'req-v1-tsk1',
            name: 'Verificación de Estado Crediticio',
            type: 'task',
            description: 'Verificar en bases comerciales que el comprador no posea inhibiciones.',
            isRequired: true
          }
        ]
      },
      {
        id: 'stg-v2',
        name: 'Estudio de Títulos',
        description: 'Revisión técnica de la escritura matriz por parte del escribano y manager.',
        requirements: [
          {
            id: 'req-v2-doc1',
            name: 'Escritura de Propiedad Antecedente',
            type: 'document',
            description: 'Copia certificada de la escritura de adquisición del actual vendedor.',
            isRequired: true
          },
          {
            id: 'req-v2-doc2',
            name: 'Plano de Mensura Aprobado',
            type: 'document',
            description: 'Plano catastral vigente del inmueble.',
            isRequired: true
          },
          {
            id: 'req-v2-tsk1',
            name: 'Solicitud de Certificado Catastral',
            type: 'task',
            description: 'Generar la solicitud web ante la dirección provincial de catastro.',
            isRequired: true
          }
        ]
      },
      {
        id: 'stg-v3',
        name: 'Boleto de Compraventa',
        description: 'Firma del boleto intermedio con entrega de posesión parcial u oferta formal.',
        requirements: [
          {
            id: 'req-v3-doc1',
            name: 'Boleto Compraventa Firmado',
            type: 'document',
            description: 'Copia escaneada del boleto firmado por ambas partes.',
            isRequired: true
          },
          {
            id: 'req-v3-form1',
            name: 'Detalle de Cuotas y Financiación',
            type: 'form',
            description: 'Fijar plazos de pago intermedios si existieran.',
            isRequired: false,
            formFields: [
              { id: 'f-bol-anticipo', label: 'Monto Anticipo (USD)', type: 'number', required: true },
              { id: 'f-bol-cuotas', label: 'Cantidad de Cuotas', type: 'number', required: true },
              { id: 'f-bol-fecha-pago', label: 'Fecha de Próximo Pago', type: 'date', required: true }
            ]
          }
        ]
      },
      {
        id: 'stg-v4',
        name: 'Preparación de Escritura',
        description: 'Liberación de deudas de servicios públicos e inscripción final del COTI.',
        requirements: [
          {
            id: 'req-v4-doc1',
            name: 'Código de Oferta de Transferencia (COTI)',
            type: 'document',
            description: 'Certificado oficial emitido ante AFIP por la venta mayor a montos mínimos.',
            isRequired: true
          },
          {
            id: 'req-v4-doc2',
            name: 'Estado de Deuda de Impuestos',
            type: 'document',
            description: 'Libre deuda de rentas provinciales y tasas municipales.',
            isRequired: true
          }
        ]
      },
      {
        id: 'stg-v5',
        name: 'Firma y Cierre',
        description: 'Firma de escritura traslativa de dominio y entrega de llaves.',
        requirements: [
          {
            id: 'req-v5-doc1',
            name: 'Escritura Matriz Definitiva',
            type: 'document',
            description: 'Escaneo del testimonio firmado y sellado por el Colegio de Escribanos.',
            isRequired: true
          },
          {
            id: 'req-v5-tsk1',
            name: 'Acta de Entrega de Llaves',
            type: 'task',
            description: 'Hacer firmar el conforme de entrega física del inmueble.',
            isRequired: true
          }
        ]
      }
    ]
  },
  {
    id: 'tmpl-alquiler',
    name: 'Alquiler Habitacional y Comercial',
    description: 'Gestión de contratos de locación con garantías propietarias, seguros de caución y deudas de ingreso.',
    industry: 'Inmobiliaria',
    stages: [
      {
        id: 'stg-a1',
        name: 'Requisitos de Admisión',
        description: 'Comprobación de ingresos y garantías provistas por el locatario.',
        requirements: [
          {
            id: 'req-a1-doc1',
            name: 'DNI de Locatario y Garante',
            type: 'document',
            description: 'Frente y dorso de los documentos de identidad legibles.',
            isRequired: true
          },
          {
            id: 'req-a1-doc2',
            name: 'Demostración de Ingresos',
            type: 'document',
            description: 'Últimos 3 recibos de sueldo o constancia de inscripción de monotributo.',
            isRequired: true
          },
          {
            id: 'req-a1-doc3',
            name: 'Título de Propiedad en Garantía',
            type: 'document',
            description: 'Escritura del inmueble ofrecido en garantía con certificado de dominio vigente.',
            isRequired: false
          }
        ]
      },
      {
        id: 'stg-a2',
        name: 'Firma del Contrato',
        description: 'Generación del contrato definitivo y firmas con certificación de firmas.',
        requirements: [
          {
            id: 'req-a2-doc1',
            name: 'Contrato de Locación Firmado',
            type: 'document',
            description: 'Documento completo firmado por Locatario, Locador y Fiadores.',
            isRequired: true
          },
          {
            id: 'req-a2-tsk1',
            name: 'Cobro de Depósito e Ingreso',
            type: 'task',
            description: 'Confirmar recepción del mes de adelanto, depósito en garantía y honorarios.',
            isRequired: true
          }
        ]
      }
    ]
  },
  {
    id: 'tmpl-credito',
    name: 'Crédito Hipotecario / Financiero',
    description: 'Aprobación de carpeta de préstamos bajo estándares de scoring crediticio bancario.',
    industry: 'Financiera',
    stages: [
      {
        id: 'stg-c1',
        name: 'Pre-Aprobación',
        description: 'Solicitud de crédito e historial de deudas.',
        requirements: [
          {
            id: 'req-c1-doc1',
            name: 'Formulario de Solicitud de Préstamo',
            type: 'document',
            description: 'Ficha de datos de solicitud de préstamo firmada.',
            isRequired: true
          },
          {
            id: 'req-c1-tsk1',
            name: 'Score Crediticio Central',
            type: 'task',
            description: 'Verificar perfil del cliente en BCRA y scoring financiero interno.',
            isRequired: true
          }
        ]
      }
    ]
  }
];

export const INITIAL_STATE: AppDataState = {
  users: INITIAL_USERS,
  templates: INITIAL_TEMPLATES,
  cases: [
    {
      id: 'case-recoleta',
      code: 'EXP-2026-RECO',
      title: 'Compraventa - Depto Recoleta 3 Ambientes',
      description: 'Expediente para la venta del departamento ubicado en Av. Las Heras 2300, 4° Piso. Operación financiada.',
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
      message: 'Tu documento "Escritura de Propiedad Antecedente" del expediente EXP-2026-RECO fue rechazado. Revisa las observaciones.',
      type: 'error',
      read: false,
      createdAt: '2026-06-22T10:01:00Z',
      caseId: 'case-recoleta'
    },
    {
      id: 'not-pale-new',
      userId: 'usr-asesor2',
      title: 'Nuevo Expediente Asignado',
      message: 'Se te ha asignado el expediente EXP-2026-PALE "Alquiler Comercial - Local Palermo Soho".',
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
      action: 'Expediente creado',
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
      content: 'Hola Lucía, te doy la bienvenida al sistema de Gestión Documental. Por favor, revisa tus expedientes asignados y no dudes en escribirme si tienes alguna consulta sobre los checklists.',
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
  ]
};

