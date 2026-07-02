import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { INITIAL_STATE, PRESET_AVATARS } from './src/data';
import { AppDataState, Case, Document, Task, Observation, Notification, AuditLog, ProcessTemplate, User } from './src/types';
import mammoth from 'mammoth';

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
    throw new Error('La clave API de Resend (RESEND_API_KEY) no está configurada en el servidor. Configure la clave real para enviar correos de verificación.');
  }

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
    throw new Error(`Error de la API de Resend (${response.status}): ${errText}`);
  } else {
    console.log(`Verification email sent successfully to ${email}`);
  }
}

// Twilio SMS Helper to send real MFA verification codes to cell phones
async function sendVerificationSms(phone: string, token: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error('La configuración de Twilio (Account SID, Auth Token o From Number) no está completa en el servidor. Configure las credenciales en Secrets para poder enviar mensajes SMS.');
  }

  // Ensure phone is in E.164 format or try to format it if possible
  let formattedPhone = phone.trim();
  if (!formattedPhone.startsWith('+')) {
    if (/^\d+$/.test(formattedPhone)) {
      formattedPhone = '+' + formattedPhone;
    }
  }

  const messageBody = `Tu código de verificación de DocFlow Pro es: ${token}. Válido por 30 minutos.`;

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

  const params = new URLSearchParams();
  params.append('To', formattedPhone);
  params.append('From', fromNumber);
  params.append('Body', messageBody);

  console.log(`[SMS-TWILIO] Intentando enviar SMS a ${formattedPhone} desde ${fromNumber}...`);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Error de la API de Twilio (${response.status}): ${errText}`);
  } else {
    console.log(`[SMS-TWILIO] SMS enviado con éxito a ${formattedPhone}`);
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
let activeSyncPromise: Promise<void> | null = null;
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_API_KEY) {
  try {
    const firebaseApp = initializeApp(firebaseConfig);
    firestoreDb = initializeFirestore(firebaseApp, {
      experimentalForceLongPolling: true,
    });
    console.log('Connected to Google Firestore with long polling enabled.');
  } catch (e) {
    console.error('Failed to connect to Google Firestore:', e);
  }
}

// Sync State to Firestore
async function syncToFirestore(state: AppDataState) {
  if (!firestoreDb) return;
  try {
    const cleanState = JSON.parse(JSON.stringify(state));

    const safeSetDoc = async (docName: string, payload: any) => {
      try {
        await setDoc(doc(firestoreDb, 'docflow', docName), payload);
      } catch (err: any) {
        console.error(`Error syncing ${docName} to Firestore:`, err.message || err);
        // Fallback: if it's too large, let's try to clean it if it's sharedDocuments
        if (docName === 'sharedDocuments' && Array.isArray(payload.data)) {
          console.warn(`Attempting to sync cleaned sharedDocuments (without large dataUrl base64) to Firestore...`);
          const cleanedDocs = payload.data.map((d: any) => ({
            ...d,
            dataUrl: (d.dataUrl && d.dataUrl.length > 100000) ? '[Contenido grande guardado localmente en servidor]' : d.dataUrl
          }));
          try {
            await setDoc(doc(firestoreDb, 'docflow', 'sharedDocuments'), { data: cleanedDocs });
            console.log(`Successfully synced cleaned sharedDocuments to Firestore.`);
          } catch (retryErr: any) {
            console.error(`Failed to sync cleaned sharedDocuments:`, retryErr.message || retryErr);
          }
        }
      }
    };

    // Parallelize all setDoc calls to maximize database write performance
    await Promise.all([
      safeSetDoc('users', { data: cleanState.users || [] }),
      safeSetDoc('templates', { data: cleanState.templates || [] }),
      safeSetDoc('cases', { data: cleanState.cases || [] }),
      safeSetDoc('documents', { data: cleanState.documents || [] }),
      safeSetDoc('tasks', { data: cleanState.tasks || [] }),
      safeSetDoc('observations', { data: cleanState.observations || [] }),
      safeSetDoc('notifications', { data: cleanState.notifications || [] }),
      safeSetDoc('auditLogs', { data: cleanState.auditLogs || [] }),
      safeSetDoc('formSubmissions', { data: cleanState.formSubmissions || [] }),
      safeSetDoc('sharedDocuments', { data: cleanState.sharedDocuments || [] }),
      safeSetDoc('config', { 
        activeIndustry: cleanState.activeIndustry || 'Inmobiliaria',
        verificationPolicies: cleanState.verificationPolicies || null,
        systemSettings: cleanState.systemSettings || null,
        systemMessages: cleanState.systemMessages || null
      })
    ]);
  } catch (e) {
    console.error('Error in syncToFirestore top level:', e);
  }
}

// Load State from Firestore in Parallel
async function loadFromFirestore(): Promise<Partial<AppDataState> | null> {
  if (!firestoreDb) return null;
  try {
    const keys = [
      'users', 'templates', 'cases', 'documents', 'tasks', 
      'observations', 'notifications', 'auditLogs', 'formSubmissions', 
      'sharedDocuments', 'config'
    ];
    // Fetch all documents concurrently to avoid sequential roundtrip network delay
    const promises = keys.map(k => getDoc(doc(firestoreDb, 'docflow', k)));
    const docs = await Promise.all(promises);
    
    const [
      usersDoc, templatesDoc, casesDoc, documentsDoc, tasksDoc,
      observationsDoc, notificationsDoc, auditLogsDoc, formSubmissionsDoc,
      sharedDocumentsDoc, configDoc
    ] = docs;

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
      sharedDocuments: sharedDocumentsDoc.exists() ? sharedDocumentsDoc.data().data : undefined,
      activeIndustry: configDoc.exists() ? configDoc.data().activeIndustry : undefined,
      verificationPolicies: configDoc.exists() ? configDoc.data().verificationPolicies : undefined,
      systemSettings: configDoc.exists() ? configDoc.data().systemSettings : undefined,
      systemMessages: configDoc.exists() ? configDoc.data().systemMessages : undefined,
    };
  } catch (e) {
    console.error('Error reading from Firestore:', e);
    return null;
  }
}

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));

// Middleware to ensure we are always serving fresh data from Firestore
app.use('/api', async (req, res, next) => {
  try {
    // 1. ALWAYS block and ensure we have the absolute latest state from Google Firestore before executing the route handler
    await ensureFreshDbState();
  } catch (err) {
    console.error('Error ensuring fresh database state in middleware:', err);
  }

  // 2. Intercept response methods to ensure any writes triggered during this request are fully completed in Firestore before the response is sent to the client
  const originalJson = res.json;
  res.json = function (body) {
    if (activeSyncPromise) {
      activeSyncPromise.then(() => {
        originalJson.call(res, body);
      }).catch((err) => {
        console.error('Error waiting for Firestore sync on res.json:', err);
        originalJson.call(res, body);
      });
    } else {
      originalJson.call(res, body);
    }
    return res;
  };

  const originalSend = res.send;
  res.send = function (body) {
    if (activeSyncPromise) {
      activeSyncPromise.then(() => {
        originalSend.call(res, body);
      }).catch((err) => {
        console.error('Error waiting for Firestore sync on res.send:', err);
        originalSend.call(res, body);
      });
    } else {
      originalSend.call(res, body);
    }
    return res;
  };

  const originalEnd = res.end;
  (res as any).end = function (...args: any[]) {
    if (activeSyncPromise) {
      activeSyncPromise.then(() => {
        originalEnd.apply(res, args);
      }).catch((err) => {
        console.error('Error waiting for Firestore sync on res.end:', err);
        originalEnd.apply(res, args);
      });
    } else {
      originalEnd.apply(res, args);
    }
  };

  next();
});

// Database is 100% remote Firestore, no local DB_FILE used

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
      avatar: PRESET_AVATARS[0].url,
    };
    state.users.push(superadmin);
  } else {
    // Make sure it is verified and active
    superadmin.isVerified = true;
    superadmin.active = true;
    if (!superadmin.passwordHash) {
      superadmin.passwordHash = DEFAULT_SUPERADMIN_PASSWORD_HASH;
    }
    if (!superadmin.avatar) {
      superadmin.avatar = PRESET_AVATARS[0].url;
    }
  }
}

function cleanDummyData(state: AppDataState) {
  // Ensure we keep templates and clean dummy records safely without deleting anything that already exists
  ensureSuperadmin(state);
  
  if (!state.users) {
    state.users = [];
    ensureSuperadmin(state);
  }

  // Strictly de-duplicate users by email (case-insensitive) to prevent any duplicate accounts
  if (state.users && Array.isArray(state.users)) {
    const seenEmails = new Set<string>();
    state.users = state.users.filter(user => {
      if (!user || !user.email) return false;
      const emailLower = user.email.toLowerCase();
      if (seenEmails.has(emailLower)) {
        return false;
      }
      seenEmails.add(emailLower);
      return true;
    });
  }

  // Ensure we have templates
  if (!state.templates || !Array.isArray(state.templates) || state.templates.length === 0) {
    state.templates = JSON.parse(JSON.stringify(INITIAL_STATE.templates || []));
  }

  // Strictly de-duplicate process templates by ID
  if (state.templates && Array.isArray(state.templates)) {
    const seenTemplateIds = new Set<string>();
    state.templates = state.templates.filter(tmpl => {
      if (!tmpl || !tmpl.id) return false;
      if (seenTemplateIds.has(tmpl.id)) {
        return false;
      }
      seenTemplateIds.add(tmpl.id);
      return true;
    });
  }

  // Initialize arrays only if they are missing or falsy
  if (!state.cases) state.cases = [];
  if (!state.documents) state.documents = [];
  if (!state.tasks) state.tasks = [];
  if (!state.observations) state.observations = [];
  if (!state.notifications) state.notifications = [];
  if (!state.auditLogs) state.auditLogs = [];
  if (!state.formSubmissions) state.formSubmissions = [];
  state.uploadRequests = state.uploadRequests || [];
  
  state.activeIndustry = state.activeIndustry || 'Inmobiliaria';
  state.verificationPolicies = state.verificationPolicies || {
    global: 'email',
    ASESOR: 'email',
    MANAGER: 'email',
    ADMIN: 'email'
  };
  if (state.verificationPolicies && !state.verificationPolicies.global) {
    state.verificationPolicies.global = state.verificationPolicies.ASESOR || 'email';
  }
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
  state.sharedDocuments = state.sharedDocuments || [];
}

// Initialize database 100% in-memory and load remotely from Firestore
function loadInitialInMemoryDB(): AppDataState {
  const state: AppDataState = {
    users: [], // Will be filled with ensureSuperadmin()
    templates: JSON.parse(JSON.stringify(INITIAL_STATE.templates || [])),
    cases: [],
    documents: [],
    tasks: [],
    observations: [],
    notifications: [],
    auditLogs: [],
    formSubmissions: [],
    uploadRequests: [],
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
    systemMessages: [],
    sharedDocuments: [],
    activeIndustry: 'Inmobiliaria'
  };
  cleanDummyData(state);
  return state;
}

// Global hydration status flag to protect remote data integrity
let isHydratedFromCloud = false;

function saveDB(state: AppDataState) {
  if (!isHydratedFromCloud) {
    console.warn('[DB-SAFE] Blocked saveDB() call because memory state is not hydrated from Firestore yet.');
    return;
  }
  // Sync to Google Cloud Firestore, and store the promise so middleware can wait for it to finish
  activeSyncPromise = syncToFirestore(state);
}

// In-Memory state
let dbState = loadInitialInMemoryDB();

let lastCloudRefreshTime = 0;
const CLOUD_REFRESH_THROTTLE_MS = 2500; // 2.5 seconds
let activeRefreshPromise: Promise<void> | null = null;

// Async startup to load from Firestore
async function initDbFromCloud() {
  const cloudState = await loadFromFirestore();
  if (cloudState === null) {
    console.error('[DB-SAFE] Failed to fetch state from Google Firestore. Skipping initialization to prevent overwriting cloud data.');
    return;
  }

  // Check if there is any data at all in the cloud state
  const hasCloudData = (cloudState.users && cloudState.users.length > 0) || 
                       (cloudState.cases && cloudState.cases.length > 0) ||
                       (cloudState.templates && cloudState.templates.length > 0);

  if (hasCloudData) {
    console.log('[DB-SAFE] Successfully hydrated state from Google Firestore.');
    
    dbState.users = cloudState.users || [];
    dbState.templates = cloudState.templates || [];
    dbState.cases = cloudState.cases || [];
    dbState.documents = cloudState.documents || [];
    dbState.tasks = cloudState.tasks || [];
    dbState.observations = cloudState.observations || [];
    dbState.notifications = cloudState.notifications || [];
    dbState.auditLogs = cloudState.auditLogs || [];
    dbState.formSubmissions = cloudState.formSubmissions || [];
    dbState.sharedDocuments = cloudState.sharedDocuments || [];
    dbState.uploadRequests = cloudState.uploadRequests || [];
    if (cloudState.activeIndustry) dbState.activeIndustry = cloudState.activeIndustry;
    if (cloudState.verificationPolicies) dbState.verificationPolicies = cloudState.verificationPolicies;
    if (cloudState.systemSettings) dbState.systemSettings = cloudState.systemSettings;
    if (cloudState.systemMessages) dbState.systemMessages = cloudState.systemMessages;

    cleanDummyData(dbState);
    isHydratedFromCloud = true;
    console.log('[DB-SAFE] In-memory database is now marked as HYDRATED.');
  } else {
    console.log('[DB-SAFE] Google Firestore is empty. Seeding initial templates and superadmin to remote cloud database...');
    // Seed initial state
    dbState = loadInitialInMemoryDB();
    cleanDummyData(dbState);
    
    // We mark it as hydrated BEFORE syncing, so that syncToFirestore is allowed to write!
    isHydratedFromCloud = true; 
    await syncToFirestore(dbState);
    console.log('[DB-SAFE] Firestore seeded and marked as HYDRATED.');
  }
}

// Initial hydration from cloud on startup
activeRefreshPromise = (async () => {
  try {
    await initDbFromCloud();
  } catch (err) {
    console.error('[DB-SAFE] Error in initial startup Firestore hydration:', err);
  } finally {
    activeRefreshPromise = null;
    lastCloudRefreshTime = Date.now();
  }
})();

// Helper to guarantee fresh data on API requests by always fetching synchronously from Firestore
async function ensureFreshDbState() {
  if (activeRefreshPromise) {
    await activeRefreshPromise;
    return;
  }

  // ALWAYS force a synchronous block until hydrated or refreshed from Google Firestore
  activeRefreshPromise = (async () => {
    try {
      await initDbFromCloud();
    } catch (err) {
      console.error('[DB-SAFE] Error forcing fresh hydration from Firestore:', err);
    } finally {
      activeRefreshPromise = null;
    }
  })();
  await activeRefreshPromise;
}

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

// Robust Gemini execution helper with retry and model fallback
async function generateContentWithRetryAndFallback(params: any): Promise<any> {
  if (!ai) {
    throw new Error('Gemini API is not initialized. Please configure GEMINI_API_KEY.');
  }

  const maxRetries = 3;
  const modelsToTry = Array.from(new Set([
    params.model || 'gemini-2.5-flash',
    'gemini-2.5-flash',
    'gemini-1.5-flash',
    'gemini-2.5-pro',
    'gemini-1.5-pro'
  ]));

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const model = modelsToTry[mIdx];
    let delay = 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Trying Gemini generation with model ${model} (attempt ${attempt}/${maxRetries})...`);
        const currentParams = {
          ...params,
          model,
        };
        const response = await ai.models.generateContent(currentParams);
        return response;
      } catch (err: any) {
        const errMsg = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
        console.error(`Gemini generation failed for model ${model} on attempt ${attempt}:`, errMsg);

        const isUnavailable = err.status === 'UNAVAILABLE' || 
                              err.statusCode === 503 || 
                              err.status === 503 ||
                              err.code === 503 ||
                              errMsg.includes('503') ||
                              errMsg.toLowerCase().includes('unavailable') ||
                              errMsg.toLowerCase().includes('high demand') ||
                              errMsg.toLowerCase().includes('resource_exhausted') ||
                              errMsg.toLowerCase().includes('quota');

        if (isUnavailable) {
          console.warn(`Model ${model} is experiencing high demand/unavailable. Handled as 503/UNAVAILABLE.`);
          if (mIdx < modelsToTry.length - 1) {
            console.warn(`Immediately falling back to the next model: ${modelsToTry[mIdx + 1]}`);
            break; // Break the attempt loop for the current model, so it moves to the next model in the outer loop
          }
        }

        // If this was the last attempt for the current model
        if (attempt === maxRetries) {
          if (mIdx < modelsToTry.length - 1) {
            console.warn(`All ${maxRetries} attempts failed for model ${model}. Falling back to next model...`);
            break; // Break the attempt loop to try next model
          } else {
            throw err; // Last model failed all attempts, rethrow the error
          }
        }

        // Exponential backoff wait for retry on the same model
        console.log(`Waiting ${delay}ms before retrying ${model} (attempt ${attempt + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
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
  const virtualTemplates = (dbState.sharedDocuments || []).map(doc => {
    let decodedContent = '';
    if (doc.dataUrl) {
      try {
        const base64Part = doc.dataUrl.includes(',') ? doc.dataUrl.split(',')[1] : doc.dataUrl;
        decodedContent = decodeURIComponent(escape(atob(base64Part)));
      } catch (e) {
        try {
          const base64Part = doc.dataUrl.includes(',') ? doc.dataUrl.split(',')[1] : doc.dataUrl;
          decodedContent = atob(base64Part);
        } catch (err) {
          decodedContent = '';
        }
      }
    }

    return {
      id: `doc-${doc.id}`,
      name: `Documento: ${doc.name}`,
      description: `Proceso creado a partir del documento compartido: ${doc.name}`,
      industry: (dbState.activeIndustry || 'Inmobiliaria') as any,
      stages: [
        {
          id: `stage-digital-${doc.id}`,
          name: 'Revisión y Firma',
          description: 'Etapa inicial para la edición, revisión y firma del documento digitalizado',
          requirements: [
            {
              id: `req-digital-${doc.id}`,
              name: doc.name,
              type: 'document',
              description: `Complete los campos y firme el documento: ${doc.name}`,
              isRequired: true,
              documentSourceType: 'digital_contract',
              linkedSharedDocumentId: doc.id
            }
          ]
        }
      ],
      originalDocumentContent: decodedContent,
      showDocumentToAll: true,
      sharedViewMode: 'both'
    };
  });

  const stateWithVirtualTemplates = {
    ...dbState,
    templates: [...(dbState.templates || []), ...virtualTemplates]
  };

  res.json(stateWithVirtualTemplates);
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

  const verificationPolicy = dbState.verificationPolicies?.global || 'email';
  const token = (verificationPolicy === 'email' || verificationPolicy === 'both') ? generateVerificationToken(6) : undefined;
  
  let tokenSms: string | undefined = undefined;
  if (verificationPolicy === 'sms' || verificationPolicy === 'both') {
    tokenSms = generateVerificationToken(6);
    while (tokenSms === token) {
      tokenSms = generateVerificationToken(6);
    }
  }

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
    verificationTokenSms: tokenSms,
    tokenCreatedAt: new Date().toISOString(),
    avatar: PRESET_AVATARS && PRESET_AVATARS.length > 0 
      ? PRESET_AVATARS[Math.floor(Math.random() * PRESET_AVATARS.length)].url 
      : ''
  };

  dbState.users.push(newUser);
  saveDB(dbState);

  let emailFailed = false;
  let emailErrorMsg = '';
  let smsFailed = false;
  let smsErrorMsg = '';

  // Only send real email via Resend if email verification is required
  if (token) {
    try {
      await sendVerificationEmail(newUser.email, `${name} ${lastName}`, token);
    } catch (err: any) {
      console.warn('No se pudo enviar el correo de verificación vía Resend:', err.message || err);
      emailFailed = true;
      emailErrorMsg = err.message || 'Error desconocido';
    }
  }

  // Send real SMS via Twilio if SMS verification is required
  if (tokenSms) {
    try {
      await sendVerificationSms(newUser.phone, tokenSms);
    } catch (err: any) {
      console.warn('No se pudo enviar el SMS de verificación vía Twilio:', err.message || err);
      smsFailed = true;
      smsErrorMsg = err.message || 'Error de envío de SMS';
    }
  }

  // Log the generated tokens in the server console for clean local/development inspection
  console.log(`[VERIFICACIÓN] Código de verificación generado para ${newUser.email}: Email=${token || 'N/A'}, SMS=${tokenSms || 'N/A'}`);

  createAudit(newUser.id, 'Registro de usuario', 'User', newUser.id, `${name} ${lastName}`);

  const { passwordHash, verificationToken, verificationTokenSms, ...safeUser } = newUser as any;
  res.status(201).json({
    ...safeUser,
    verificationPolicy,
    emailFailed,
    emailErrorMsg,
    smsFailed,
    smsErrorMsg,
    devEmailToken: token,
    devSmsToken: tokenSms
  });
});

app.post('/api/auth/login', async (req, res) => {
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
    const now = Date.now();
    const createdTime = user.tokenCreatedAt ? new Date(user.tokenCreatedAt).getTime() : 0;
    const diff = now - createdTime;

    const verificationPolicy = dbState.verificationPolicies?.global || 'email';
    let message = 'Debe verificar su cuenta para poder iniciar sesión.';
    let isNew = false;
    let emailFailed = false;
    let emailErrorMsg = '';
    let smsFailed = false;
    let smsErrorMsg = '';

    const needsEmail = verificationPolicy === 'email' || verificationPolicy === 'both';
    const needsSms = verificationPolicy === 'sms' || verificationPolicy === 'both';

    const hasTokens = (needsEmail ? !!user.verificationToken : true) && (needsSms ? !!user.verificationTokenSms : true);

    if (!hasTokens || diff >= 30 * 60 * 1000) {
      const emailToken = needsEmail ? generateVerificationToken(6) : undefined;
      
      let smsToken: string | undefined = undefined;
      if (needsSms) {
        smsToken = generateVerificationToken(6);
        while (smsToken === emailToken) {
          smsToken = generateVerificationToken(6);
        }
      }

      user.verificationToken = emailToken;
      user.verificationTokenSms = smsToken;
      user.tokenCreatedAt = new Date().toISOString();
      saveDB(dbState);
      isNew = true;
      
      if (emailToken) {
        try {
          await sendVerificationEmail(user.email, `${user.name} ${user.lastName}`, emailToken);
        } catch (err: any) {
          console.warn('No se pudo enviar el correo automático de verificación en el login:', err.message || err);
          emailFailed = true;
          emailErrorMsg = err.message || 'Error de envío de correo';
        }
      }

      smsFailed = false;
      smsErrorMsg = '';
      if (smsToken) {
        try {
          await sendVerificationSms(user.phone, smsToken);
        } catch (err: any) {
          console.warn('No se pudo enviar el SMS de verificación en el login vía Twilio:', err.message || err);
          smsFailed = true;
          smsErrorMsg = err.message || 'Error de envío de SMS';
        }
      }

      console.log(`[VERIFICACIÓN] Código de verificación login generado para ${user.email}: Email=${emailToken || 'N/A'}, SMS=${smsToken || 'N/A'}`);

      if (verificationPolicy === 'both') {
        message = 'Se han generado nuevos códigos de verificación para email y SMS (duración máxima 30 minutos).';
      } else if (verificationPolicy === 'sms') {
        message = 'Se ha generado un nuevo código de verificación por SMS (duración máxima 30 minutos).';
      } else {
        message = 'Se ha generado un nuevo código de verificación enviado a su correo (duración máxima 30 minutos).';
      }
    } else {
      if (verificationPolicy === 'both') {
        message = 'Debe ingresar el código de verificación de 6 dígitos enviado a su correo y el código SMS enviado a su celular.';
      } else if (verificationPolicy === 'sms') {
        message = 'Debe ingresar el código de verificación de 6 dígitos enviado por SMS a su celular.';
      } else {
        message = 'Debe ingresar el código de verificación de 6 dígitos enviado a su correo electrónico.';
      }
    }

    return res.json({
      error: message,
      requiresVerification: true,
      email: user.email,
      verificationPolicy: verificationPolicy,
      emailFailed,
      emailErrorMsg,
      smsFailed,
      smsErrorMsg,
      devEmailToken: user.verificationToken,
      devSmsToken: user.verificationTokenSms
    });
  }

  const { passwordHash, verificationToken, tokenCreatedAt, ...safeUser } = user as any;
  createAudit(user.id, 'Inicio de sesión exitoso', 'User', user.id, `${user.name} ${user.lastName}`);
  res.json({ success: true, user: safeUser });
});

app.post('/api/auth/verify', (req, res) => {
  const { email, token, smsToken } = req.body;
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

  const now = Date.now();
  const createdTime = user.tokenCreatedAt ? new Date(user.tokenCreatedAt).getTime() : 0;
  const diff = now - createdTime;

  if (diff >= 30 * 60 * 1000) {
    return res.status(400).json({ 
      error: 'El código de verificación ha expirado (duración máxima 30 minutos). Intente iniciar sesión para generar un nuevo código automáticamente.' 
    });
  }

  const verificationPolicy = dbState.verificationPolicies?.global || 'email';

  if (verificationPolicy === 'email') {
    if (!token) {
      return res.status(400).json({ error: 'Código de verificación de Email requerido.' });
    }
    if (user.verificationToken !== token) {
      return res.status(400).json({ error: 'Código de verificación de Email incorrecto.' });
    }
  } else if (verificationPolicy === 'sms') {
    const codeToVerify = smsToken || token;
    if (!codeToVerify) {
      return res.status(400).json({ error: 'Código de verificación por SMS requerido.' });
    }
    if (user.verificationTokenSms !== codeToVerify) {
      return res.status(400).json({ error: 'Código de verificación por SMS incorrecto.' });
    }
  } else if (verificationPolicy === 'both') {
    if (!token || !smsToken) {
      return res.status(400).json({ error: 'Se requieren ambos códigos de verificación (Email y SMS).' });
    }
    if (user.verificationToken !== token) {
      return res.status(400).json({ error: 'Código de verificación de Email incorrecto.' });
    }
    if (user.verificationTokenSms !== smsToken) {
      return res.status(400).json({ error: 'Código de verificación por SMS incorrecto.' });
    }
  }

  // Mark as verified
  user.isVerified = true;
  delete user.verificationToken;
  delete user.verificationTokenSms;
  delete user.tokenCreatedAt;
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

  const verificationPolicy = dbState.verificationPolicies?.global || 'email';
  const needsEmail = verificationPolicy === 'email' || verificationPolicy === 'both';
  const needsSms = verificationPolicy === 'sms' || verificationPolicy === 'both';

  const now = Date.now();
  const createdTime = user.tokenCreatedAt ? new Date(user.tokenCreatedAt).getTime() : 0;
  const diff = now - createdTime;

  const hasTokens = (needsEmail ? !!user.verificationToken : true) && (needsSms ? !!user.verificationTokenSms : true);
  let isNew = false;

  if (!hasTokens || diff >= 30 * 60 * 1000) {
    const emailToken = needsEmail ? generateVerificationToken(6) : undefined;
    
    let smsToken: string | undefined = undefined;
    if (needsSms) {
      smsToken = generateVerificationToken(6);
      while (smsToken === emailToken) {
        smsToken = generateVerificationToken(6);
      }
    }

    user.verificationToken = emailToken;
    user.verificationTokenSms = smsToken;
    user.tokenCreatedAt = new Date().toISOString();
    saveDB(dbState);
    isNew = true;
  }

  let emailFailed = false;
  let emailErrorMsg = '';
  let smsFailed = false;
  let smsErrorMsg = '';

  // Only send real email via Resend if email verification is required
  if (needsEmail && user.verificationToken) {
    try {
      await sendVerificationEmail(user.email, `${user.name} ${user.lastName}`, user.verificationToken);
    } catch (err: any) {
      console.warn('No se pudo enviar el correo de verificación reenviado:', err.message || err);
      emailFailed = true;
      emailErrorMsg = err.message || 'Error de envío de correo';
    }
  }

  // Send real SMS via Twilio if SMS verification is required
  if (needsSms && user.verificationTokenSms) {
    try {
      await sendVerificationSms(user.phone, user.verificationTokenSms);
    } catch (err: any) {
      console.warn('No se pudo enviar el SMS de verificación reenviado vía Twilio:', err.message || err);
      smsFailed = true;
      smsErrorMsg = err.message || 'Error de envío de SMS';
    }
  }

  console.log(`[VERIFICACIÓN] Código de verificación reenviado para ${user.email}: Email=${user.verificationToken || 'N/A'}, SMS=${user.verificationTokenSms || 'N/A'}`);

  res.json({
    success: true,
    message: isNew ? 'Se generó y envió un nuevo código de verificación.' : 'Se reenvió el código de verificación existente.',
    verificationPolicy,
    emailFailed,
    emailErrorMsg,
    smsFailed,
    smsErrorMsg,
    devEmailToken: user.verificationToken,
    devSmsToken: user.verificationTokenSms
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
  const { name, lastName, email, phone, role, active, address, city, province, country, password, avatar, currentUserId } = req.body;

  const targetUser = dbState.users.find(u => u.id === id);
  if (!targetUser) {
    return res.status(404).json({ error: 'Usuario destino no encontrado.' });
  }

  const currentUser = dbState.users.find(u => u.id === currentUserId);
  if (!currentUser) {
    return res.status(401).json({ error: 'No autorizado. Se requiere usuario actual.' });
  }

  // Permission Hierarchy Verification
  const { hasSensitiveEditPermissionOverride } = req.body;
  const isEditingSensitive = email !== undefined || password !== undefined || role !== undefined || active !== undefined || hasSensitiveEditPermissionOverride !== undefined;

  if (isEditingSensitive) {
    const actorRole = currentUser.role;
    const targetRole = targetUser.role;
    let allowed = false;

    // Support override flags
    if (currentUser.hasSensitiveEditPermissionOverride === false) {
      allowed = false;
    } else if (currentUser.hasSensitiveEditPermissionOverride === true) {
      allowed = targetRole !== 'SUPERADMIN' || actorRole === 'SUPERADMIN';
    } else {
      // Default hierarchy rules
      if (actorRole === 'SUPERADMIN') {
        // Superadmin has full access to manage anyone
        allowed = true;
      } else if (actorRole === 'ADMIN') {
        if (targetRole === 'MANAGER' || targetRole === 'ASESOR') {
          allowed = true;
        }
      } else if (actorRole === 'MANAGER') {
        if (targetRole === 'ASESOR') {
          allowed = true;
        }
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
  if (avatar !== undefined) targetUser.avatar = avatar;

  if (email !== undefined) targetUser.email = email.toLowerCase();
  if (role !== undefined) targetUser.role = role.toUpperCase() as any;
  if (active !== undefined) targetUser.active = active;
  if (hasSensitiveEditPermissionOverride !== undefined) {
    targetUser.hasSensitiveEditPermissionOverride = hasSensitiveEditPermissionOverride;
  }
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
  if (!currentUser || !['SUPERADMIN', 'ADMIN', 'MANAGER'].includes(currentUser.role)) {
    return res.status(403).json({ error: 'Solo el Superadmin, Admin o Manager pueden decidir las configuraciones de la plataforma.' });
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
  const receiver = receiverId === 'system' 
    ? { id: 'system', name: 'Sistema', lastName: 'de Reasignaciones', role: 'SYSTEM' } 
    : dbState.users.find(u => u.id === receiverId);
  
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
    const isUserAdminOrSuper = dbState.users.find(u => u.id === userId && ['SUPERADMIN', 'ADMIN'].includes(u.role));
    if (msg.senderId === userId) {
      msg.deletedBySender = isTrash;
    }
    if (msg.receiverId === userId || (msg.receiverId === 'system' && isUserAdminOrSuper)) {
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
    const isUserAdminOrSuper = dbState.users.find(u => u.id === userId && ['SUPERADMIN', 'ADMIN'].includes(u.role));
    if (msg.senderId === userId) {
      (msg as any).permanentDeletedBySender = true;
    }
    if (msg.receiverId === userId || (msg.receiverId === 'system' && isUserAdminOrSuper)) {
      (msg as any).permanentDeletedByReceiver = true;
    }
    
    // If deleted permanently by both, or by the only participant concerned, remove it
    const delSender = msg.senderId === userId ? true : (msg as any).permanentDeletedBySender;
    const delReceiver = (msg.receiverId === userId || (msg.receiverId === 'system' && isUserAdminOrSuper)) ? true : (msg as any).permanentDeletedByReceiver;
    
    if (delSender && delReceiver) {
      dbState.systemMessages.splice(index, 1);
    }
    saveDB(dbState);
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'Mensaje no encontrado' });
});

// Helper to find a template (regular or virtual from sharedDocuments)
function findTemplateById(templateId: string): any {
  let template = dbState.templates.find(t => t.id === templateId);
  if (!template && templateId && templateId.startsWith('doc-')) {
    const docId = templateId.replace('doc-', '');
    const docObj = dbState.sharedDocuments?.find(d => d.id === docId);
    if (docObj) {
      let decodedContent = '';
      if (docObj.dataUrl) {
        try {
          const base64Part = docObj.dataUrl.includes(',') ? docObj.dataUrl.split(',')[1] : docObj.dataUrl;
          decodedContent = decodeURIComponent(escape(atob(base64Part)));
        } catch (e) {
          try {
            const base64Part = docObj.dataUrl.includes(',') ? docObj.dataUrl.split(',')[1] : docObj.dataUrl;
            decodedContent = atob(base64Part);
          } catch (err) {
            decodedContent = '';
          }
        }
      }
      return {
        id: templateId,
        name: docObj.name,
        description: `Proceso creado a partir del documento: ${docObj.name}`,
        industry: (dbState.activeIndustry || 'Inmobiliaria') as any,
        stages: [
          {
            id: `stage-digital-${docId}`,
            name: 'Revisión y Firma',
            description: 'Etapa inicial para la edición, revisión y firma del documento digitalizado',
            requirements: [
              {
                id: `req-digital-${docId}`,
                name: docObj.name,
                type: 'document',
                description: `Complete los campos y firme el documento: ${docObj.name}`,
                isRequired: true,
                documentSourceType: 'digital_contract',
                linkedSharedDocumentId: docId
              }
            ]
          }
        ],
        originalDocumentContent: decodedContent,
        showDocumentToAll: true,
        sharedViewMode: 'both'
      };
    }
  }
  return template;
}

// Helper to check template permissions
function canUserManageTemplates(userId: string): boolean {
  const user = dbState.users.find(u => u.id === userId);
  if (!user) return false;
  if (user.role === 'SUPERADMIN') return true;
  if (user.role === 'ASESOR') return false;
  
  // ADMIN or MANAGER
  const allowAdminManager = dbState.systemSettings?.allowAdminManagerTemplates !== false;
  return allowAdminManager;
}

// 2. Templates
app.get('/api/templates', (req, res) => {
  res.json(dbState.templates);
});

app.post('/api/templates', (req, res) => {
  const { name, description, industry, stages, originalDocumentContent, showDocumentToAll, sharedViewMode, currentUserId } = req.body;
  const creatorId = currentUserId || 'usr-system';
  
  if (!canUserManageTemplates(creatorId)) {
    return res.status(403).json({ error: 'No tienes permisos suficientes para crear o modificar plantillas de procesos.' });
  }

  const newTemplate: ProcessTemplate = {
    id: `tmpl-${Date.now()}`,
    name,
    description,
    industry,
    stages: stages || [],
    originalDocumentContent: originalDocumentContent || '',
    showDocumentToAll: showDocumentToAll !== undefined ? showDocumentToAll : true,
    sharedViewMode: sharedViewMode || 'both'
  };
  dbState.templates.push(newTemplate);
  saveDB(dbState);
  createAudit(creatorId, 'Plantilla de proceso creada', 'ProcessTemplate', newTemplate.id, name);
  res.status(201).json(newTemplate);
});

app.put('/api/templates/:id', (req, res) => {
  const { id } = req.params;
  const { name, description, industry, stages, originalDocumentContent, showDocumentToAll, sharedViewMode, currentUserId } = req.body;
  const editorId = currentUserId || 'usr-system';
  
  if (!canUserManageTemplates(editorId)) {
    return res.status(403).json({ error: 'No tienes permisos suficientes para modificar plantillas de procesos.' });
  }

  const templateIndex = dbState.templates.findIndex(t => t.id === id);
  if (templateIndex === -1) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada.' });
  }
  const updatedTemplate = {
    ...dbState.templates[templateIndex],
    name: name || dbState.templates[templateIndex].name,
    description: description !== undefined ? description : dbState.templates[templateIndex].description,
    industry: industry || dbState.templates[templateIndex].industry,
    stages: stages !== undefined ? stages : dbState.templates[templateIndex].stages,
    originalDocumentContent: originalDocumentContent !== undefined ? originalDocumentContent : dbState.templates[templateIndex].originalDocumentContent,
    showDocumentToAll: showDocumentToAll !== undefined ? showDocumentToAll : (dbState.templates[templateIndex].showDocumentToAll ?? true),
    sharedViewMode: sharedViewMode !== undefined ? sharedViewMode : (dbState.templates[templateIndex].sharedViewMode ?? 'both')
  };
  dbState.templates[templateIndex] = updatedTemplate;
  saveDB(dbState);
  createAudit(editorId, 'Plantilla de proceso actualizada', 'ProcessTemplate', id, updatedTemplate.name);
  res.json(updatedTemplate);
});

app.delete('/api/templates/:id', (req, res) => {
  const { id } = req.params;
  const deleterId = (req.query.currentUserId as string) || 'usr-system';
  
  if (!canUserManageTemplates(deleterId)) {
    return res.status(403).json({ error: 'No tienes permisos suficientes para eliminar plantillas de procesos.' });
  }

  const templateIndex = dbState.templates.findIndex(t => t.id === id);
  if (templateIndex === -1) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada.' });
  }
  
  const deletedTemplate = dbState.templates[templateIndex];
  dbState.templates.splice(templateIndex, 1);
  saveDB(dbState);
  createAudit(deleterId, 'Plantilla de proceso eliminada', 'ProcessTemplate', id, deletedTemplate.name);
  res.json({ success: true, id });
});

// 3. Cases (Legajos)
app.get('/api/cases', (req, res) => {
  res.json(dbState.cases);
});

app.post('/api/cases', (req, res) => {
  const { title, description, templateId, assignedAdvisorId, assignedManagerId, participants, currentUserId, documentContent } = req.body;
  let template = findTemplateById(templateId);
  if (!template) {
    if (!templateId) {
      template = {
        id: '',
        name: 'Sin Plantilla',
        description: 'Proceso personalizado sin plantilla predefinida',
        industry: (dbState.activeIndustry || 'Inmobiliaria') as any,
        stages: [
          {
            id: 'stage-default',
            name: 'Revisión General',
            description: 'Etapa inicial de carga y validación de documentos',
            requirements: []
          }
        ],
        originalDocumentContent: ''
      };
    } else {
      return res.status(404).json({ error: 'Plantilla de proceso no encontrada o documento no válido.' });
    }
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
    updatedAt: new Date().toISOString(),
    documentContent: documentContent || template.originalDocumentContent || '',
    showDocumentToAll: template.showDocumentToAll !== undefined ? template.showDocumentToAll : true,
    sharedViewMode: template.sharedViewMode || 'both'
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
  createAudit(creatorId, status === 'pending_assignment' ? 'Solicitud de legajo creada' : 'Legajo creado', 'Case', caseId, title);
  
  if (assignedAdvisorId) {
    createNotification(assignedAdvisorId, 'Nuevo Legajo Creado', `Tu legajo ${code}: "${title}" fue registrado.`, 'info', caseId);
  }

  // If pending assignment, notify all managers
  if (status === 'pending_assignment') {
    dbState.users.forEach(u => {
      if (u.role === 'MANAGER' || u.role === 'ADMIN' || u.role === 'SUPERADMIN') {
        createNotification(u.id, 'Nueva Solicitud de Legajo', `El asesor solicita iniciar el legajo ${code}: "${title}". Disponible para asignar.`, 'warning', caseId);
      }
    });
  } else if (finalManagerId) {
    createNotification(finalManagerId, 'Legajo Asignado', `Se te asignó el legajo ${code}: "${title}".`, 'info', caseId);
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
  createAudit(currentUserId, `Asignó manager a legajo`, 'Case', id, caseObj.title);
  createNotification(caseObj.assignedAdvisorId, 'Manager Asignado', `El manager ${manager.name} ${manager.lastName} ha sido asignado a tu legajo.`, 'success', id);
  createNotification(managerId, 'Nuevo Legajo Asignado', `Has sido asignado al legajo ${caseObj.code}: "${caseObj.title}".`, 'info', id);

  res.json(caseObj);
});

// Advisor requests stage review from assigned manager
app.post('/api/cases/:id/request-review', (req, res) => {
  const { id } = req.params;
  const { currentUserId, note } = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado.' });
  }

  const user = dbState.users.find(u => u.id === currentUserId);
  if (!user) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  // Set status to pending_review
  caseObj.status = 'pending_review';
  caseObj.updatedAt = new Date().toISOString();

  // Find assigned manager and notify them
  const managerId = caseObj.assignedManagerId;
  if (managerId) {
    const template = findTemplateById(caseObj.templateId);
    const stageName = template?.stages?.[caseObj.currentStageIndex]?.name || 'Etapa actual';
    createNotification(
      managerId,
      '🔍 Revisión de Etapa Solicitada',
      `El asesor ${user.name} ${user.lastName} ha completado el trabajo de la etapa "${stageName}" en el legajo "${caseObj.title}" y solicita su revisión.${note ? ` Nota del asesor: "${note}"` : ''}`,
      'info',
      caseObj.id
    );
  }

  createAudit(currentUserId, `Solicitó revisión de la etapa actual al Manager`, 'Case', caseObj.id, caseObj.title);
  saveDB(dbState);

  res.json({ success: true, case: caseObj });
});

// Request reassignment of case from manager to system
app.post('/api/cases/:id/request-reassignment', (req, res) => {
  const { id } = req.params;
  const { currentUserId, reason } = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado.' });
  }

  const sender = dbState.users.find(u => u.id === currentUserId);
  if (!sender) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  const systemMsg = {
    id: `msg-${Date.now()}`,
    senderId: currentUserId,
    senderName: `${sender.name} ${sender.lastName}`,
    senderRole: sender.role,
    receiverId: 'system',
    receiverName: 'Sistema de Reasignaciones',
    receiverRole: 'SYSTEM',
    subject: `⚠️ Solicitud de Reasignación: Legajo "${caseObj.title}"`,
    content: `El Manager ${sender.name} ${sender.lastName} solicita reasignar o liberar el legajo "${caseObj.title}" (ID: ${caseObj.id}).\n\nMotivo del Manager:\n"${reason}"`,
    createdAt: new Date().toISOString(),
    read: false,
    deletedBySender: false,
    deletedByReceiver: false,
    attachments: []
  };

  if (!dbState.systemMessages) dbState.systemMessages = [];
  dbState.systemMessages.unshift(systemMsg);

  // Notify Admins and Superadmins
  const admins = dbState.users.filter(u => ['SUPERADMIN', 'ADMIN'].includes(u.role));
  admins.forEach(admin => {
    createNotification(
      admin.id,
      '🔄 Solicitud de Reasignación',
      `El manager ${sender.name} ha solicitado reasignar el legajo "${caseObj.title}".`,
      'warning',
      caseObj.id
    );
  });

  createAudit(currentUserId, `Solicitó reasignación / liberación del legajo`, 'Case', caseObj.id, caseObj.title);
  saveDB(dbState);

  res.json({ success: true, message: systemMsg });
});

// Update case basic details
app.put('/api/cases/:id', (req, res) => {
  const { id } = req.params;
  const { title, description, assignedAdvisorId, status, participants, documentContent, showDocumentToAll, sharedViewMode } = req.body;
  
  const caseIdx = dbState.cases.findIndex(c => c.id === id);
  if (caseIdx === -1) {
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }

  const oldCase = dbState.cases[caseIdx];
  const updatedCase = {
    ...oldCase,
    title: title || oldCase.title,
    description: description || oldCase.description,
    assignedAdvisorId: assignedAdvisorId || oldCase.assignedAdvisorId,
    status: status || oldCase.status,
    participants: participants || oldCase.participants,
    documentContent: documentContent !== undefined ? documentContent : oldCase.documentContent,
    showDocumentToAll: showDocumentToAll !== undefined ? showDocumentToAll : (oldCase.showDocumentToAll ?? true),
    sharedViewMode: sharedViewMode !== undefined ? sharedViewMode : (oldCase.sharedViewMode ?? 'both'),
    updatedAt: new Date().toISOString()
  };

  dbState.cases[caseIdx] = updatedCase;

  if (assignedAdvisorId && assignedAdvisorId !== oldCase.assignedAdvisorId) {
    createNotification(assignedAdvisorId, 'Legajo Reasignado', `Se te reasignó el legajo ${oldCase.code}: "${updatedCase.title}"`, 'info', id);
  }

  saveDB(dbState);
  const updaterId = req.body.currentUserId || 'usr-system';
  const action = req.body.auditAction || 'Legajo actualizado';
  createAudit(updaterId, action, 'Case', id, updatedCase.title);
  res.json(updatedCase);
});

// Delete case (superadmin only)
app.delete('/api/cases/:id', (req, res) => {
  const { id } = req.params;
  const deleterId = (req.query.currentUserId as string) || (req.body.currentUserId as string) || 'usr-system';

  const user = dbState.users.find(u => u.id === deleterId);
  if (!user || user.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Solo el Superadmin puede eliminar legajos.' });
  }

  const caseIdx = dbState.cases.findIndex(c => c.id === id);
  if (caseIdx === -1) {
    return res.status(404).json({ error: 'Legajo no encontrado.' });
  }

  const deletedCase = dbState.cases[caseIdx];
  dbState.cases.splice(caseIdx, 1);

  // Clean up related objects in the same database state
  dbState.tasks = (dbState.tasks || []).filter(t => t.caseId !== id);
  dbState.documents = (dbState.documents || []).filter(d => d.caseId !== id);
  dbState.observations = (dbState.observations || []).filter(o => o.caseId !== id);
  dbState.notifications = (dbState.notifications || []).filter(n => n.caseId !== id);

  saveDB(dbState);
  createAudit(deleterId, 'Legajo eliminado permanentemente', 'Case', id, deletedCase.title);
  res.json({ success: true, id });
});

// Add Participant dynamically to case
app.post('/api/cases/:id/participants', (req, res) => {
  const { id } = req.params;
  const participant = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }

  if (!caseObj.participants) {
    caseObj.participants = [];
  }

  const newParticipant = {
    id: participant.id || `prt-${Date.now()}`,
    name: participant.name || '',
    lastName: participant.lastName || '',
    dni: participant.dni || '',
    cuitCuil: participant.cuitCuil || '',
    email: participant.email || '',
    phone: participant.phone || '',
    birthDate: participant.birthDate || undefined,
    role: participant.role || 'Vendedor',
    comments: participant.comments || ''
  };

  caseObj.participants.push(newParticipant);

  caseObj.updatedAt = new Date().toISOString();
  saveDB(dbState);

  const creatorId = participant.currentUserId || 'usr-system';
  createAudit(creatorId, `Añadió el actor ${newParticipant.name} ${newParticipant.lastName} (Rol: ${newParticipant.role})`, 'Case', id, caseObj.title);
  res.json(caseObj);
});

// Update actor dynamically inside case
app.put('/api/cases/:id/participants/:participantId', (req, res) => {
  const { id, participantId } = req.params;
  const participant = req.body;
  const userId = participant.currentUserId || 'usr-system';

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }

  const partIdx = (caseObj.participants || []).findIndex(p => p.id === participantId);
  if (partIdx === -1) {
    return res.status(404).json({ error: 'Actor no encontrado en el legajo' });
  }

  const oldPart = caseObj.participants[partIdx];
  caseObj.participants[partIdx] = {
    ...oldPart,
    name: participant.name !== undefined ? participant.name : oldPart.name,
    lastName: participant.lastName !== undefined ? participant.lastName : oldPart.lastName,
    dni: participant.dni !== undefined ? participant.dni : oldPart.dni,
    cuitCuil: participant.cuitCuil !== undefined ? participant.cuitCuil : oldPart.cuitCuil,
    email: participant.email !== undefined ? participant.email : oldPart.email,
    phone: participant.phone !== undefined ? participant.phone : oldPart.phone,
    birthDate: participant.birthDate !== undefined ? participant.birthDate : oldPart.birthDate,
    role: participant.role !== undefined ? participant.role : oldPart.role,
    comments: participant.comments !== undefined ? participant.comments : oldPart.comments
  };

  caseObj.updatedAt = new Date().toISOString();
  saveDB(dbState);

  createAudit(userId, `Modificó/editó datos del actor ${caseObj.participants[partIdx].name} ${caseObj.participants[partIdx].lastName} (Rol: ${caseObj.participants[partIdx].role})`, 'Case', id, caseObj.title);
  res.json(caseObj);
});

// Delete actor dynamically from case
app.delete('/api/cases/:id/participants/:participantId', (req, res) => {
  const { id, participantId } = req.params;
  const userId = (req.query.currentUserId as string) || 'usr-system';

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }

  const removedPart = (caseObj.participants || []).find(p => p.id === participantId);
  caseObj.participants = (caseObj.participants || []).filter(p => p.id !== participantId);

  caseObj.updatedAt = new Date().toISOString();
  saveDB(dbState);

  if (removedPart) {
    createAudit(userId, `Eliminó el actor ${removedPart.name} ${removedPart.lastName} (Rol: ${removedPart.role || 'Actor'})`, 'Case', id, caseObj.title);
  } else {
    createAudit(userId, `Eliminó un actor del legajo`, 'Case', id, caseObj.title);
  }

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
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }

  const template = findTemplateById(caseObj.templateId);
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
  caseObj.isCurrentStageApproved = false; // Reset for next stage
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
      `El legajo ${caseObj.code} avanzó a la etapa: "${nextStage.name}"`,
      'success',
      id
    );
    createAudit(userId, `Avanzó etapa a "${nextStage.name}"`, 'Case', id, caseObj.title);
  } else {
    createNotification(
      caseObj.assignedAdvisorId,
      'Legajo Finalizado',
      `Felicidades! El legajo ${caseObj.code} ha sido finalizado exitosamente.`,
      'success',
      id
    );
    createAudit(userId, 'Finalizó legajo', 'Case', id, caseObj.title);
  }

  saveDB(dbState);
  res.json({ success: true, case: caseObj });
});

// 4.5 Approve Stage Endpoint
app.post('/api/cases/:id/approve-stage', (req, res) => {
  const { id } = req.params;
  const { userId } = req.body;

  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }

  const template = findTemplateById(caseObj.templateId);
  if (!template) {
    return res.status(404).json({ error: 'Plantilla de proceso no encontrada' });
  }

  const currentStage = template.stages[caseObj.currentStageIndex];
  if (!currentStage) {
    return res.status(400).json({ error: 'Etapa actual no válida' });
  }

  // Set current stage as approved
  caseObj.isCurrentStageApproved = true;
  caseObj.updatedAt = new Date().toISOString();

  createNotification(
    caseObj.assignedAdvisorId,
    'Etapa Aprobada',
    `¡Tu etapa actual "${currentStage.name}" ha sido aprobada por el Manager!`,
    'success',
    id
  );

  createAudit(userId, `Aprobó etapa "${currentStage.name}"`, 'Case', id, caseObj.title);
  saveDB(dbState);

  res.json({ success: true, case: caseObj });
});

// Check advancement status API (Dry run)
app.get('/api/cases/:id/validate', (req, res) => {
  const { id } = req.params;
  const caseObj = dbState.cases.find(c => c.id === id);
  if (!caseObj) {
    return res.status(404).json({ error: 'Legajo no encontrado' });
  }
  const template = findTemplateById(caseObj.templateId);
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

// Shared Documents Library (Biblioteca de Documentos)
app.get('/api/shared-documents', (req, res) => {
  const userId = req.query.userId as string;
  const userRole = req.query.role as string;

  if (!userId || !userRole) {
    return res.status(400).json({ error: 'Se requiere userId y role.' });
  }

  // If SUPERADMIN, return all shared documents
  if (userRole === 'SUPERADMIN') {
    return res.json(dbState.sharedDocuments || []);
  }

  // Filter based on allowedRoles or allowedUserIds
  const visible = (dbState.sharedDocuments || []).filter(doc => {
    const roleAllowed = doc.allowedRoles && doc.allowedRoles.includes(userRole);
    const userAllowed = doc.allowedUserIds && doc.allowedUserIds.includes(userId);
    return roleAllowed || userAllowed;
  });

  res.json(visible);
});

app.post('/api/shared-documents', (req, res) => {
  const { name, fileName, fileSize, fileBase64, allowedRoles, allowedUserIds, currentUserId } = req.body;

  // Only superadmin or authorized template managers can upload shared documents
  const user = dbState.users.find(u => u.id === currentUserId);
  if (!user || (user.role !== 'SUPERADMIN' && !canUserManageTemplates(currentUserId))) {
    return res.status(403).json({ error: 'No tienes permisos suficientes para subir documentos compartidos.' });
  }

  if (!name || !fileName || !fileBase64) {
    return res.status(400).json({ error: 'Faltan campos obligatorios (nombre, nombre de archivo o contenido).' });
  }

  const newDoc = {
    id: `sh-doc-${Date.now()}`,
    name,
    fileName,
    fileSize: fileSize || 0,
    uploadedBy: `${user.name} ${user.lastName} (${user.role})`,
    uploadedAt: new Date().toISOString(),
    allowedRoles: allowedRoles || ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'],
    allowedUserIds: allowedUserIds || [],
    dataUrl: fileBase64
  };

  dbState.sharedDocuments = dbState.sharedDocuments || [];
  dbState.sharedDocuments.push(newDoc);
  saveDB(dbState);

  createAudit(user.id, `Subió documento compartido "${name}"`, 'SharedDocument', newDoc.id, name);

  // Notify target users
  const targetRoles = allowedRoles || [];
  dbState.users.forEach(u => {
    if (u.id !== user.id && (targetRoles.includes(u.role) || (allowedUserIds && allowedUserIds.includes(u.id)))) {
      createNotification(
        u.id,
        'Nuevo Documento Compartido',
        `El Superadmin ha subido el documento "${name}" a la biblioteca para tu descarga.`,
        'info'
      );
    }
  });

  res.status(201).json(newDoc);
});

app.put('/api/shared-documents/:id', (req, res) => {
  const { id } = req.params;
  const { allowedRoles, allowedUserIds, currentUserId, name, dataUrl, fileSize } = req.body;

  const user = dbState.users.find(u => u.id === currentUserId);
  if (!user) {
    return res.status(401).json({ error: 'Usuario no autenticado o no encontrado.' });
  }

  dbState.sharedDocuments = dbState.sharedDocuments || [];
  const doc = dbState.sharedDocuments.find(d => d.id === id);
  if (!doc) {
    return res.status(404).json({ error: 'Documento no encontrado.' });
  }

  if (name) doc.name = name;
  if (dataUrl !== undefined) doc.dataUrl = dataUrl;
  if (fileSize !== undefined) doc.fileSize = fileSize;

  // Only allow SUPERADMIN to modify allowedRoles or allowedUserIds
  if (user.role === 'SUPERADMIN') {
    if (allowedRoles) doc.allowedRoles = allowedRoles;
    if (allowedUserIds) doc.allowedUserIds = allowedUserIds;
  } else if (allowedRoles || allowedUserIds) {
    return res.status(403).json({ error: 'Sólo el Superadmin puede actualizar los permisos de acceso.' });
  }

  saveDB(dbState);
  createAudit(user.id, `Actualizó o editó el documento compartido "${doc.name}"`, 'SharedDocument', id, doc.name);

  res.json({ success: true, doc });
});

app.delete('/api/shared-documents/:id', (req, res) => {
  const { id } = req.params;
  const currentUserId = req.query.currentUserId as string;

  const user = dbState.users.find(u => u.id === currentUserId);
  if (!user || user.role !== 'SUPERADMIN') {
    return res.status(403).json({ error: 'Sólo el Superadmin puede eliminar documentos de la biblioteca.' });
  }

  dbState.sharedDocuments = dbState.sharedDocuments || [];
  const index = dbState.sharedDocuments.findIndex(d => d.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Documento no encontrado en la biblioteca.' });
  }

  const deletedDoc = dbState.sharedDocuments[index];
  dbState.sharedDocuments.splice(index, 1);
  saveDB(dbState);

  createAudit(user.id, `Eliminó documento compartido "${deletedDoc.name}"`, 'SharedDocument', id, deletedDoc.name);

  res.json({ success: true, id });
});

// 5. Document Management
app.get('/api/cases/:caseId/documents', (req, res) => {
  const { caseId } = req.params;
  const role = req.query.role as string;
  let docs = dbState.documents.filter(d => d.caseId === caseId);
  if (role && role !== 'SUPERADMIN' && role !== 'ADMIN') {
    docs = docs.filter(d => {
      if (d.status === 'approved' && d.allowedRoles && d.allowedRoles.length > 0) {
        return d.allowedRoles.includes(role);
      }
      return true;
    });
  }
  res.json(docs);
});

// Advisor Uploads/Replaces Document
app.post(['/api/documents', '/api/documents/upload'], (req, res) => {
  const { caseId, stageId, requirementId, name, fileName, fileSize, uploadedBy } = req.body;

  // Resolve requirement name from template if not provided by frontend
  let resolvedName = name;
  if (!resolvedName && requirementId) {
    if (requirementId.startsWith('req-digital-')) {
      const docId = requirementId.replace('req-digital-', '');
      const docObj = dbState.sharedDocuments?.find(d => d.id === docId);
      if (docObj) {
        resolvedName = docObj.name;
      }
    } else {
      const template = dbState.templates.find(t => t.stages.some(s => s.requirements.some(r => r.id === requirementId)));
      const reqObj = template?.stages.flatMap(s => s.requirements).find(r => r.id === requirementId);
      resolvedName = reqObj?.name || fileName || 'Documento';
    }
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
      `El asesor cargó "${resolvedName}" en el legajo ${caseObj.code}`,
      'info',
      caseId
    );
  }

  res.status(201).json(doc);
});

// Create upload authorization request from Advisor
app.post('/api/upload-requests/create', (req, res) => {
  const { caseId, stageId, requirementId, requirementName, requestedBy, requestedExtension } = req.body;
  
  if (!caseId || !requirementId || !requestedBy) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios.' });
  }

  const newRequest = {
    id: `uprq-${Date.now()}`,
    caseId,
    stageId,
    requirementId,
    requirementName: requirementName || 'Documento',
    requestedBy,
    requestedAt: new Date().toISOString(),
    status: 'pending' as const,
    requestedExtension: requestedExtension || '.pdf'
  };

  dbState.uploadRequests = dbState.uploadRequests || [];
  dbState.uploadRequests.push(newRequest);

  const caseObj = dbState.cases.find(c => c.id === caseId);
  const user = dbState.users.find(u => u.id === requestedBy);

  saveDB(dbState);
  createAudit(requestedBy, `Solicitó permiso para subir archivo para "${newRequest.requirementName}" (Extensión: ${newRequest.requestedExtension})`, 'Case', caseId, caseObj?.title || 'Legajo');

  // Notify assigned Manager or Admin
  if (caseObj) {
    const notifyUserId = caseObj.assignedManagerId || dbState.users.find(u => u.role === 'MANAGER' || u.role === 'ADMIN')?.id || 'usr-super';
    createNotification(
      notifyUserId,
      'Solicitud de Subida de Archivo',
      `El asesor ${user?.name || ''} solicita subir un archivo ${newRequest.requestedExtension} para "${newRequest.requirementName}" en legajo ${caseObj.code}`,
      'warning',
      caseId
    );
  }

  res.status(201).json(newRequest);
});

// Review upload authorization request (approve/reject)
app.post('/api/upload-requests/review', (req, res) => {
  const { id, status, allowedExtension, allowedMaxWeight, responseComment, reviewedBy } = req.body;

  dbState.uploadRequests = dbState.uploadRequests || [];
  const reqObj = dbState.uploadRequests.find(r => r.id === id);
  if (!reqObj) {
    return res.status(404).json({ error: 'Solicitud no encontrada.' });
  }

  reqObj.status = status; // 'approved' | 'rejected'
  reqObj.allowedExtension = allowedExtension || reqObj.requestedExtension;
  reqObj.allowedMaxWeight = allowedMaxWeight ? Number(allowedMaxWeight) : 5; // Default 5MB
  reqObj.responseComment = responseComment || '';
  reqObj.reviewedBy = reviewedBy;
  reqObj.reviewedAt = new Date().toISOString();

  const caseObj = dbState.cases.find(c => c.id === reqObj.caseId);
  const reviewer = dbState.users.find(u => u.id === reviewedBy);

  saveDB(dbState);
  createAudit(reviewedBy || 'usr-manager1', `${status === 'approved' ? 'Aprobó' : 'Rechazó'} solicitud de subida para "${reqObj.requirementName}"`, 'Case', reqObj.caseId, caseObj?.title || 'Legajo');

  // Notify Advisor
  createNotification(
    reqObj.requestedBy,
    status === 'approved' ? 'Solicitud de Subida Aprobada' : 'Solicitud de Subida Rechazada',
    `Tu solicitud para subir "${reqObj.requirementName}" fue ${status === 'approved' ? 'APROBADA' : 'RECHAZADA'} por ${reviewer?.name || 'el Manager'}. ${status === 'approved' ? `Peso máx: ${reqObj.allowedMaxWeight}MB, Ext: ${reqObj.allowedExtension}` : `Nota: ${reqObj.responseComment}`}`,
    status === 'approved' ? 'success' : 'error',
    reqObj.caseId
  );

  res.status(200).json(reqObj);
});

// Manager Approves or Rejects Document
app.all('/api/documents/:id/review', (req, res) => {
  if (req.method !== 'POST' && req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { id } = req.params;
  const { status, observationText, userId, reviewedBy, allowedRoles } = req.body; // status: 'approved' | 'rejected'
  const finalUserId = userId || reviewedBy || 'usr-manager1';

  const doc = dbState.documents.find(d => d.id === id);
  if (!doc) {
    return res.status(404).json({ error: 'Documento no encontrado' });
  }

  const caseObj = dbState.cases.find(c => c.id === doc.caseId);

  doc.status = status;
  if (status === 'approved') {
    doc.allowedRoles = allowedRoles || ['SUPERADMIN', 'ADMIN', 'MANAGER', 'ASESOR'];
  }
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
      `Se agregó una observación en el legajo ${caseObj.code}: "${text}"`,
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

app.post('/api/audit-logs/log', (req, res) => {
  const { userId, action, entityType, entityId, entityName } = req.body;
  if (!userId || !action) {
    return res.status(400).json({ error: 'userId y action son requeridos.' });
  }
  const logObj = createAudit(userId, action, entityType || 'ClientAction', entityId || '', entityName || '');
  res.json({ success: true, log: logObj });
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
            `La inteligencia artificial auditó y aprobó con éxito tu documento "${doc.name}" en el legajo ${caseObj.code}.`,
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

    const response = await generateContentWithRetryAndFallback({
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
          `La IA de Gemini auditó y aprobó con éxito tu documento "${doc.name}" en el legajo ${caseObj.code}.`,
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

// Helper to clean and parse JSON responses from Gemini safely
function cleanAndParseJSON(rawText: string): any {
  let cleaned = (rawText || '').trim();
  
  // Try to find a valid JSON block starting with { or [
  const firstBrace = cleaned.indexOf('{');
  const firstBracket = cleaned.indexOf('[');
  
  let startIdx = -1;
  let endToken = '';
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endToken = '}';
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endToken = ']';
  }
  
  if (startIdx !== -1) {
    const lastTokenIdx = cleaned.lastIndexOf(endToken);
    if (lastTokenIdx !== -1 && lastTokenIdx > startIdx) {
      cleaned = cleaned.substring(startIdx, lastTokenIdx + 1);
    }
  }

  // Remove any leftover markers just in case
  cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.error('Initial JSON parse failed. Attempting cleanup of control characters. Raw text length:', rawText.length);
    // Fallback: If there are unescaped control characters like newlines within strings, we can try to sanitize them or trim
    cleaned = cleaned.trim();
    try {
      return JSON.parse(cleaned);
    } catch (innerErr: any) {
      console.error('Final JSON parse failed. Error:', innerErr.message, 'Cleaned text was:', cleaned);
      throw innerErr;
    }
  }
}

// AI Process Template Generation
app.post('/api/gemini/generate-template', async (req, res) => {
  const { industry, promptDescription, prompt: bodyPrompt, createdBy } = req.body;
  
  if (createdBy && !canUserManageTemplates(createdBy)) {
    return res.status(403).json({ error: 'No tienes permisos suficientes para generar plantillas de procesos.' });
  }

  const finalDescription = promptDescription || bodyPrompt || 'Proceso general';
  const finalIndustry = industry || 'Administrativo';

  if (!ai) {
    // Fallback template builder if no key
    const newTmpl: ProcessTemplate = {
      id: `tmpl-${Date.now()}`,
      name: `Proceso IA: ${finalDescription.substring(0, 30)}...`,
      description: `Proceso auto-generado para el rubro ${finalIndustry}. Basado en la descripción: ${finalDescription}`,
      industry: (finalIndustry as any) || 'Inmobiliaria',
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
    createAudit(createdBy || 'usr-admin', 'Plantilla IA Creada (Offline Fallback)', 'ProcessTemplate', newTmpl.id, newTmpl.name);
    return res.json({ success: true, template: newTmpl });
  }

  try {
    const promptText = `Actúa como un Ingeniero de Procesos experto en el rubro: "${finalIndustry}".
Un cliente requiere una plantilla de proceso automatizado reutilizable basada en la siguiente descripción: "${finalDescription}".

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

    const response = await generateContentWithRetryAndFallback({
      model: 'gemini-3.5-flash',
      contents: promptText,
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsedTemplate = cleanAndParseJSON(response.text || '{}');
    
    // Add stable IDs
    const finalTemplate: ProcessTemplate = {
      id: `tmpl-ia-${Date.now()}`,
      name: parsedTemplate.name || `Proceso IA - ${finalIndustry}`,
      description: parsedTemplate.description || `Proceso generado mediante Inteligencia Artificial.`,
      industry: parsedTemplate.industry || (finalIndustry as any) || 'Administrativo',
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
    createAudit(createdBy || 'usr-admin', 'Plantilla IA Creada con Gemini', 'ProcessTemplate', finalTemplate.id, finalTemplate.name);

    res.json({ success: true, template: finalTemplate });
  } catch (err: any) {
    console.error('Error in Gemini Template Generation:', err);
    res.status(500).json({ error: 'Error generando plantilla inteligente', details: err.message });
  }
});


// AI Process Template 100% Digitizer Route
app.post('/api/gemini/digitize-template', async (req, res) => {
  const { fileBase64, mimeType, fileName, textProposal, industry, generateFlow, currentUserId } = req.body;
  
  if (currentUserId && !canUserManageTemplates(currentUserId)) {
    return res.status(403).json({ error: 'No tienes permisos suficientes para digitalizar plantillas de procesos.' });
  }

  const shouldGenerateFlow = generateFlow === true;

  if (!ai) {
    // Fallback digitizer
    const newTemplate: ProcessTemplate = {
      id: `tmpl-dig-${Date.now()}`,
      name: `Plantilla Digitalizada: ${industry || 'General'}`,
      description: `Plantilla digitalizada a partir del documento subido para el rubro ${industry || 'General'}.`,
      industry: industry || 'Administrativo',
      originalDocumentContent: `DOCUMENTO COMPROMISO DIGITALIZADO

En la ciudad de Buenos Aires, se establece el siguiente acuerdo entre las partes firmantes en base al documento original digitalizado.

DATOS DEL CLIENTE / TITULAR:
- Nombre Completo: [Nombre del Titular]
- Documento de Identidad: [DNI/Pasaporte]
- Fecha de Nacimiento: [Fecha]
- Rubro del Proceso: ${industry || 'Administrativo'}

CLAUSULAS PRINCIPALES:
1. Las partes aceptan y reconocen en un 100% el contenido del documento tal cual fue subido y digitalizado en la plataforma DocFlow Pro.
2. Este documento digitalizado se encuentra listo para completar y ser editado digitalmente de forma íntegra.
3. Se procederá a realizar las tareas y etapas de verificación correspondientes que se desprenden del proceso.

Leído y firmado de conformidad por los participantes en el legajo.`,
      showDocumentToAll: true,
      stages: shouldGenerateFlow ? [
        {
          id: `stg-ia-1-${Date.now()}`,
          name: '1. Validación y Carga del Documento Digitalizado',
          description: 'Carga de datos obtenidos a partir de la digitalización inicial.',
          requirements: [
            { id: `req-ia-1-doc-${Date.now()}`, name: 'Documento Original Digitalizado', type: 'document', description: 'Copia digital que dio origen a este proceso.', isRequired: true },
            { id: `req-ia-1-frm-${Date.now()}`, name: 'Formulario de Datos Extraídos', type: 'form', description: 'Revisión y completitud de datos extraídos por la IA.', isRequired: true, formFields: [
                { id: 'f-ia-ext-data', label: 'Datos del Cliente o Legajo', type: 'text', required: true }
              ] 
            }
          ]
        }
      ] : []
    };

    dbState.templates.push(newTemplate);
    saveDB(dbState);
    createAudit(currentUserId || 'usr-admin', 'Plantilla Digitalizada (Offline Fallback)', 'ProcessTemplate', newTemplate.id, newTemplate.name);
    return res.json({ success: true, template: newTemplate });
  }

  try {
    let promptText = '';
    
    if (shouldGenerateFlow) {
      promptText = `Actúa como un transcriptor y digitalizador de documentos profesional y extremadamente minucioso para el rubro: "${industry || 'Administrativo'}".
Tu objetivo absoluto es DIGITALIZAR AL 100% el documento adjunto o el texto provisto de forma totalmente LITERAL, sin agregarle ni cambiarle nada, absolutamente nada. No quiero que agregues, inventes ni modifiques nada del contenido.

Debes realizar dos tareas y retornarlas en un formato JSON estructurado:

TAREA 1 (Trascripción y Preservación Literal Absoluta):
- Transcribe el 100% del documento provisto. Debe ser una copia exacta, letra por letra, palabra por palabra, signo por signo, párrafo por párrafo, título por título.
- REGLA DE ORO CRÍTICA: NO agregues comentarios, aclaraciones, prefacios, explicaciones, notas introductorias, firmas de la IA, ni pies de página. El texto debe comenzar y terminar exactamente donde comienza y termina el documento original.
- REGLA DE ORO CRÍTICA DE VARIABLES Y SUBRAYADOS: NO inventes placeholders ni variables que no estén escritas en el documento original (por ejemplo, NO inventes ni agregues cosas como "[Nombres y Apellidos Completos] / [DNI Comprador]" ni similares). Si el original tiene líneas en blanco o líneas de subrayado para completar (ej. "Nombre: _________"), consérvalas EXACTAMENTE como líneas de subrayado literales "_________". NO las reemplaces con placeholders ni con etiquetas inventadas. El texto debe ser 100% original e idéntico al que figura en el documento.

TAREA 2 (Estructura de Control de Procesos por Etapas):
- Crea una propuesta de flujo interactivo estructurado de 2 a 5 etapas lógicas basado en el ciclo operativo del documento. Cada etapa tendrá requisitos lógicos (document, form o task).

Retorna ÚNICAMENTE un objeto JSON que se ajuste al siguiente esquema de Typescript de manera estricta y sin markdown de código (solo el JSON puro para parsear directamente):

interface ProcessTemplate {
  name: string; // Título formal idéntico del proceso o de la plantilla
  description: string; // Breve descripción detallada basada únicamente en el documento
  industry: "Inmobiliaria" | "Jurídico" | "Seguros" | "Financiera" | "Recursos Humanos" | "Administrativo";
  originalDocumentContent: string; // Trascripción 100% IDÉNTICA, literal y exacta del documento, conservando párrafos, espaciados y líneas de subrayado exactas. Sin comentarios ni prefacios de la IA.
  stages: {
    name: string; // Nombre de la etapa (ej: "1. Recepción", "2. Tasación")
    description: string; // Qué se debe lograr en esta etapa
    requirements: {
      name: string; // Título del requisito
      type: "document" | "form" | "task";
      description: string; // Instrucciones del requisito para el asesor
      isRequired: boolean;
      formFields?: {
        id: string; // clave única del campo
        label: string; // etiqueta visible para el formulario (ej: "Monto Solicitado")
        type: "text" | "number" | "date" | "select" | "boolean";
        required: boolean;
        options?: string[]; // sólo si type es "select"
      }[];
    }[];
  }[];
}`;
    } else {
      promptText = `Actúa como un transcriptor y digitalizador de documentos profesional y extremadamente minucioso para el rubro: "${industry || 'Administrativo'}".
Tu única tarea es TRANSCRIBIR y DIGITALIZAR AL 100% el documento adjunto o texto provisto, manteniéndolo TOTALMENTE IDÉNTICO, respetando todas las cláusulas, títulos, párrafos y estructura literal sin agregarle ni cambiarle nada de nada.

REGLAS DE ORO ABSOLUTAS Y CRÍTICAS:
1. TRASCRIPCIÓN 100% LITERAL: No omitas palabras, no resumas secciones, no alteres ninguna coma, punto o palabra. Debe ser idéntico al documento que se sube.
2. SIN AGREGAR COMENTARIOS: No coloques prefacios, explicaciones, introducciones de la IA, notas aclaratorias, firmas del modelo, ni conclusiones. El texto debe comenzar y finalizar exactamente donde empieza y termina el original.
3. PRESERVACIÓN DE LÍNEAS DE SUBRAYADO: Si en el texto original hay líneas en blanco, guiones o subrayados para rellenar (por ejemplo: "________" o "............"), déjalos EXACTAMENTE como están. NO inventes etiquetas, placeholders ni corchetes que no existan literalmente en el texto (por ejemplo, NO inventes ni coloques "[Nombres y Apellidos Completos] / [DNI Comprador]" ni similares).
4. SIN FLUJO DE ETAPAS: Como no se solicitó un Flujo Inteligente de Etapas, el arreglo de stages DEBE ser un arreglo vacío: [].

Retorna ÚNICAMENTE un objeto JSON que se ajuste a esta interfaz de TypeScript de forma estricta (retorna solo el JSON puro, sin bloques de código ni markdown):

interface ProcessTemplate {
  name: string; // Título formal idéntico del proceso o de la plantilla
  description: string; // Breve descripción detallada basada únicamente en el documento
  industry: "Inmobiliaria" | "Jurídico" | "Seguros" | "Financiera" | "Recursos Humanos" | "Administrativo";
  originalDocumentContent: string; // El texto completo, continuo e íntegro del documento original trascrito al 100% idéntico y literal, conservando subrayados, sin comentarios ni modificaciones de la IA.
  stages: []; // Debe ser obligatoriamente un arreglo vacío [] ya que no se solicitó un flujo de etapas.
}`;
    }

    const parts: any[] = [];
    if (fileBase64) {
      const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;
      const detectedMimeType = mimeType || (fileBase64.includes(',') ? fileBase64.split(';')[0].split(':')[1] : 'application/pdf');

      const isDocx = detectedMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || (fileName && fileName.endsWith('.docx'));
      const isDoc = detectedMimeType === 'application/msword' || (fileName && fileName.endsWith('.doc'));

      if (isDocx || isDoc) {
        try {
          const buffer = Buffer.from(base64Data, 'base64');
          const result = await mammoth.extractRawText({ buffer });
          const textContent = result.value;
          parts.push({ text: `Contenido extraído del documento Word (${fileName || 'documento'}):\n${textContent}` });
          console.log(`Word document text extracted successfully with mammoth. Length: ${textContent.length}`);
        } catch (docxErr: any) {
          console.error('Error parsing Word document with mammoth:', docxErr);
          parts.push({ text: `[Error leyendo documento Word de forma nativa. Nombre de archivo: ${fileName || 'documento'}]` });
        }
      } else if (detectedMimeType.startsWith('text/')) {
        try {
          const textContent = Buffer.from(base64Data, 'base64').toString('utf-8');
          parts.push({ text: `Contenido del documento de texto:\n${textContent}` });
        } catch (e) {
          console.error('Error decoding plain text base64 in backend:', e);
          if (textProposal) {
            parts.push({ text: `Texto o contenido provisto para digitalizar:\n${textProposal}` });
          }
        }
      } else {
        parts.push({
          inlineData: {
            mimeType: detectedMimeType,
            data: base64Data
          }
        });
      }
    } else if (textProposal) {
      parts.push({ text: `Texto o contenido provisto para digitalizar:\n${textProposal}` });
    }
    parts.push({ text: promptText });

    const response = await generateContentWithRetryAndFallback({
      model: 'gemini-3.5-flash',
      contents: { parts },
      config: {
        responseMimeType: 'application/json'
      }
    });

    const parsedTemplate = cleanAndParseJSON(response.text || '{}');

    // Add stable IDs
    const finalTemplate: ProcessTemplate = {
      id: `tmpl-dig-${Date.now()}`,
      name: parsedTemplate.name || `Proceso Digitalizado - ${industry || 'General'}`,
      description: parsedTemplate.description || `Proceso digitalizado mediante Inteligencia Artificial Gemini 3.5.`,
      industry: parsedTemplate.industry || (industry as any) || 'Administrativo',
      originalDocumentContent: parsedTemplate.originalDocumentContent || '',
      showDocumentToAll: true,
      stages: (parsedTemplate.stages || []).map((stg: any, sIdx: number) => ({
        id: `stg-dig-${sIdx}-${Date.now()}`,
        name: stg.name,
        description: stg.description,
        requirements: (stg.requirements || []).map((req: any, rIdx: number) => ({
          id: `req-dig-${sIdx}-${rIdx}-${Date.now()}`,
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
    createAudit(currentUserId || 'usr-admin', 'Plantilla Digitalizada con Gemini', 'ProcessTemplate', finalTemplate.id, finalTemplate.name);

    res.json({ success: true, template: finalTemplate });
  } catch (err: any) {
    console.error('Error in Gemini Template Digitization:', err);
    res.status(500).json({ error: 'Error digitalizando plantilla inteligente', details: err.message });
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
