import admin from 'firebase-admin';

// Inicialização preguiçosa (lazy) do Firebase Admin SDK. Necessário apenas
// para os endpoints que precisam ESCREVER em nome de outro usuário com
// segurança (ex: creditar quem indicou um amigo). Toda a leitura/escrita dos
// dados do PRÓPRIO usuário continua no cliente via Firebase client SDK.
//
// Sem essas variáveis, os endpoints que dependem do Admin SDK ficam
// desativados com aviso — o servidor NUNCA crasha por causa disso.
let app: admin.app.App | null = null;
let initTried = false;

/**
 * Normaliza a FIREBASE_PRIVATE_KEY para funcionar no Windows e Linux.
 *
 * Problemas comuns no .env do Windows:
 *  1. Quebras de linha viram \r\n ou ficam como literal \\n (dois chars)
 *  2. dotenv às vezes mantém as aspas externas ao redor do valor
 *  3. Chave pode vir com \\n (dupla barra) ao invés de \n real
 */
function parsePrivateKey(raw: string | undefined): string | null {
  if (!raw) return null;

  let key = raw;

  // Remove aspas externas que o dotenv às vezes mantém
  if ((key.startsWith('"') && key.endsWith('"')) ||
      (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // Converte \\n literal (dois chars: backslash + n) para \n real
  key = key.replace(/\\n/g, '\n');

  // Remove \r que o Windows injeta nas quebras de linha
  key = key.replace(/\r/g, '');

  // Valida formato PEM básico
  if (!key.includes('-----BEGIN') || !key.includes('-----END')) {
    console.error(
      '[firebaseAdmin] ❌ FIREBASE_PRIVATE_KEY não é uma chave PEM válida.\n' +
      '  Certifique-se de que o valor no .env começa com:\n' +
      '  FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\nCONTEÚDO\\n-----END PRIVATE KEY-----\\n"\n' +
      '  (use \\\\n — duas barras + n — para representar quebras de linha no .env)'
    );
    return null;
  }

  return key;
}

export function getAdminApp(): admin.app.App | null {
  if (app) return app;
  if (initTried) return null;
  initTried = true;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = parsePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  if (!projectId || !clientEmail || !privateKey) {
    console.warn(
      '[firebaseAdmin] ⚠️  Credenciais de Service Account ausentes ou inválidas.\n' +
      '  Cache Firestore e referral ficarão desativados.\n' +
      '  Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL e FIREBASE_PRIVATE_KEY no .env.'
    );
    return null;
  }

  try {
    app = admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    console.log('[firebaseAdmin] ✅ Firebase Admin SDK inicializado com sucesso.');
    return app;
  } catch (err: any) {
    // NUNCA derruba o servidor — apenas desativa as features que precisam do Admin SDK
    console.error(
      '[firebaseAdmin] ❌ Falha ao inicializar Firebase Admin SDK:\n  ' + (err?.message || err) +
      '\n\n  ── Como corrigir no Windows ──' +
      '\n  1. Abra o JSON da Service Account baixado do Firebase Console' +
      '\n  2. Copie o campo "private_key" (incluindo -----BEGIN e -----END)' +
      '\n  3. No .env, cole assim (com \\\\n — duas barras + n — para cada quebra):' +
      '\n     FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\\\\nSUA_CHAVE\\\\n-----END PRIVATE KEY-----\\\\n"' +
      '\n  4. Alternativamente: use FIREBASE_KEY_FILE=./serviceAccount.json (veja abaixo)\n'
    );
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
