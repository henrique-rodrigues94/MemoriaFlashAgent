import admin from 'firebase-admin';

// Inicialização preguiçosa do Firebase Admin SDK.
let app: admin.app.App | null = null;
let initTried = false;

function parsePrivateKey(raw: string | undefined): string | null {
  if (!raw) return null;
  let key = raw;
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) key = key.slice(1, -1);
  key = key.replace(/\\n/g, '\n').replace(/\r/g, '');
  if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
    console.error('[firebaseAdmin] ❌ FIREBASE_PRIVATE_KEY não é uma chave PEM válida. Use \\n para representar quebras de linha no .env.');
    return null;
  }
  return key;
}

export function getAdminApp(): admin.app.App | null {
  if (app) return app;
  if (initTried) return null;
  initTried = true;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    console.warn('[firebaseAdmin] ⚠️ Credenciais ausentes ou inválidas; recursos Firestore/Admin desativados.');
    return null;
  }

  try {
    app = admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }) });

    // O Agent trabalha com respostas de IA e vários campos são opcionais.
    // O Firestore rejeita undefined por padrão; omitimos esses campos para
    // que um dado opcional ausente não derrube todo o lote.
    admin.firestore(app).settings({ ignoreUndefinedProperties: true });

    console.log('[firebaseAdmin] ✅ Firebase Admin SDK inicializado com sucesso.');
    return app;
  } catch (err: any) {
    console.error('[firebaseAdmin] ❌ Falha ao inicializar Firebase Admin SDK:', err?.message || err);
    return null;
  }
}

export function getAdminAuth() {
  const a = getAdminApp();
  return a ? admin.auth(a) : null;
}

export function getAdminFirestore() {
  const a = getAdminApp();
  return a ? admin.firestore(a) : null;
}
