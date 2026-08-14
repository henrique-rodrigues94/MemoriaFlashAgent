// 📁 flashmind-ai/src/server/ai/tasks/generateCurriculum.ts
import { Type } from '@google/genai';
import { aiOrchestrator } from '../index';
import { getCurriculum, saveCurriculum } from '../../db/db';

export type EducationLevel = 'fundamental' | 'medio' | 'faculdade' | 'concurso' | 'tecnico';

export interface CurriculumCategory {
  category: string;
  topics: string[];
}

// ─── Prompts por nível ────────────────────────────────────────────────────────

const LEVEL_SYSTEM_SUFFIX: Record<EducationLevel, string> = {
  fundamental: `- Linguagem simples e clara. Conteúdo alinhado à BNCC (1º ao 9º ano).
- Subtópicos devem ser concretos e acessíveis para crianças e adolescentes.`,

  medio: `- Linguagem formal porém acessível. Conteúdo da BNCC para Ensino Médio.
- Priorize tópicos cobrados no ENEM e principais vestibulares brasileiros.`,

  faculdade: `- Linguagem técnica, nível de graduação universitária.
- Subtópicos devem refletir a ementa típica de cursos de graduação no Brasil.
- Inclua fundamentos teóricos, metodologias e aplicações práticas da área.`,

  tecnico: `- Foco em competências práticas e aplicadas.
- Inclua normas técnicas, procedimentos, equipamentos e situações reais de trabalho.
- Conteúdo alinhado ao ensino técnico profissionalizante (SENAI, SENAC, ETECs etc.).`,

  concurso: `- ATENÇÃO ESPECIAL: você está gerando conteúdo para preparação de CONCURSO PÚBLICO.
- Base nos editais reais das principais bancas brasileiras: CESPE/CEBRASPE, FGV, FCC, VUNESP, IBFC, NUCEPE, UEG, FUNRIO.
- Para cargos específicos (Perito Criminal, Delegado, Auditor, Analista, etc.), use o programa dos concursos mais recentes desse cargo.
- Os tópicos devem refletir EXATAMENTE o que cai nas provas, com ênfase em:
  * Lei seca (artigos, incisos e parágrafos cobrados com frequência)
  * Jurisprudência consolidada dos tribunais superiores (STF, STJ, TST)
  * Entendimentos sumulados das bancas
  * Pontos diferenciadores que caem em "pegadinhas"
- Organize por área de conhecimento da forma como aparece nos editais.
- NÃO inclua conteúdos raramente cobrados ou de nível muito teórico/acadêmico.`,
};

// ─── Contexto adicional por cargo/matéria em concurso ─────────────────────────
// Banco de conhecimento sobre o programa real dos principais concursos.
// Cresce conforme novos cargos são identificados.

function getConcursoContext(subject: string): string {
  const s = subject.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Perito Criminal / Criminalística
  if (/perito|criminalistica|pericia/.test(s)) {
    return `CONTEXTO ESPECÍFICO — PERITO CRIMINAL:
Baseie-se nos editais recentes de concursos para Perito Criminal da Polícia Civil e Federal (PCDF, PCSP, PCMG, PCBA, PCRS, PCES, PCGO, DPF, PGE, etc.) e perícias estaduais.
Bancas frequentes: CESPE/CEBRASPE, VUNESP, IBFC, FGV, NUCEPE.

Matérias e tópicos típicos desses editais:
1. Criminalística Geral: conceito, histórico, princípios (troca de Locard), local de crime, cadeia de custódia (Lei 13.964/2019 — Pacote Anticrime), classificação de locais, isolamento e preservação.
2. Documentoscopia: análise de documentos, falsificações, grafoscopia, datiloscopia (papiloroscopia), sistemas de classificação (Vucetich, Henry, galton).
3. Balística Forense: armas de fogo (classificação, funcionamento, câmara), munição, fenômenos do disparo, resíduo de disparo (GSR), trajetória de projéteis, distância de disparo.
4. Toxicologia Forense: substâncias psicoativas, testes presuntivos e confirmatórios, cadeia de custódia toxicológica, lei antidrogas (Lei 11.343/2006).
5. Medicina Legal / Tanatologia: causa mortis, fenômenos cadavéricos, traumatologia forense, sexologia forense, asfixia, intoxicações exógenas.
6. Informática Forense: análise de dispositivos digitais, hash, metadados, cadeia de custódia digital, legislação (Marco Civil, LGPD, Lei de Crimes Cibernéticos 12.737/2012).
7. Incêndio e Explosões: origem e causa de incêndio, ponto de ignição, acelerador de chamas, explosivos, dinâmica do fogo.
8. Química e Biologia Forense: análise de vestígios biológicos (DNA, sangue, sêmen), sorologia forense, química analítica aplicada.
9. Legislação Pertinente: CPP (provas — arts. 155-250), Código Penal (crimes contra a pessoa, patrimônio, tráfico), Lei 9.807/1999, Res. 213/2015 CNJ, Portaria MJ sobre perícia.
10. Redação Oficial e Laudo Pericial: estrutura do laudo, quesitos, linguagem técnica, conclusão fundamentada.`;
  }

  // Delegado de Polícia
  if (/delegado/.test(s)) {
    return `CONTEXTO ESPECÍFICO — DELEGADO DE POLÍCIA:
Editais recentes: PCDF, PCSP, PCMG, PCBA, PCRS, PCGO, PCPR, PCES, DPF.
Bancas: CESPE/CEBRASPE, FGV, VUNESP, IBFC.
Matérias típicas: Direito Penal (Parte Geral e Especial), Direito Processual Penal, Direito Constitucional, Direito Administrativo, Legislação Especial (Lei de Drogas, ECA, Lei Maria da Penha, Estatuto do Desarmamento, Pacote Anticrime), Medicina Legal, Criminalística, Direitos Humanos.`;
  }

  // Auditor Fiscal / Receita
  if (/auditor|fiscal|receita|tributar/.test(s)) {
    return `CONTEXTO ESPECÍFICO — AUDITOR FISCAL / RECEITA:
Editais recentes: Receita Federal, SEFAZ estaduais, TCU, TCE.
Bancas: CESPE/CEBRASPE, FGV, FCC, VUNESP.
Matérias típicas: Direito Tributário (CTN, CF/88 arts. 145-162), Legislação Tributária Federal/Estadual, Contabilidade Geral e Pública, Auditoria, Direito Administrativo, Raciocínio Lógico, Tecnologia da Informação (para cargos TI).`;
  }

  // Analista/Técnico Judiciário
  if (/judiciario|judici|tribunal|trf|tjsp|stj|stf/.test(s)) {
    return `CONTEXTO ESPECÍFICO — ANALISTA/TÉCNICO JUDICIÁRIO:
Editais recentes: STJ, STF, TRF (1ª a 6ª Região), TRT, TRE, TJ estaduais.
Bancas: CESPE/CEBRASPE, FGV, FCC, VUNESP.
Matérias típicas: Direito Constitucional, Direito Administrativo, Direito Processual Civil, Direito Processual Penal, Português, Raciocínio Lógico, Informática, Regimento Interno do respectivo tribunal.`;
  }

  // Agente / Escrivão de Polícia
  if (/agente|escrivao|escrivão|investigador/.test(s)) {
    return `CONTEXTO ESPECÍFICO — AGENTE/ESCRIVÃO/INVESTIGADOR DE POLÍCIA:
Editais recentes: Polícias Civis estaduais (PCDF, PCSP, PCMG, etc.).
Bancas: CESPE/CEBRASPE, VUNESP, IBFC, NUCEPE.
Matérias típicas: Direito Penal (parte geral e crimes), Direito Processual Penal, Direito Constitucional, Legislação Especial (Lei de Drogas, ECA, Maria da Penha), Língua Portuguesa, Raciocínio Lógico, Informática Básica.`;
  }

  // Nenhum contexto específico — instrução genérica para concurso
  return `CONTEXTO: Use como referência os editais mais recentes publicados para o cargo/área "${subject}" nas principais bancas brasileiras (CESPE/CEBRASPE, FGV, FCC, VUNESP, IBFC). Se o cargo não for identificável, gere o conteúdo mais cobrado genericamente para concursos públicos dessa área.`;
}

// ─── Função principal ─────────────────────────────────────────────────────────

export async function generateCurriculumTask(args: {
  subject: string;
  educationLevel: EducationLevel;
  language?: string;
}): Promise<{ categories: CurriculumCategory[]; providerUsed: string; cacheHit?: boolean }> {
  const { subject, educationLevel, language = 'pt' } = args;
  const langInstruction = language === 'pt' ? 'em Português do Brasil' : `in ${language}`;
  const levelSuffix = LEVEL_SYSTEM_SUFFIX[educationLevel] ?? LEVEL_SYSTEM_SUFFIX.medio;
  const concursoContext = educationLevel === 'concurso' ? getConcursoContext(subject) : '';

  const systemPrompt = `Você é um especialista em currículo educacional e preparação para concursos públicos brasileiros.
Sua tarefa: gerar uma grade curricular COMPLETA e PRECISA para a matéria/cargo indicado, baseada em conteúdo REAL.

REGRAS OBRIGATÓRIAS:
- Retorne APENAS JSON válido. Sem markdown, sem texto fora do JSON.
- Categorias: 4 a 10, cobrindo toda a grade programática relevante.
- Subtópicos: 3 a 8 por categoria, ESPECÍFICOS e REAIS (não genéricos).
- NÃO use subtópicos vagos como "Revisão Geral", "Introdução a X", "Outros temas".
- Cada subtópico deve ser algo que um candidato/aluno saberia estudar diretamente.

DIRETRIZES DO NÍVEL:
${levelSuffix}
${concursoContext ? '\n' + concursoContext : ''}`;

  const userPrompt = `Gere a grade curricular completa para: "${subject}"
${educationLevel === 'concurso' ? 'Modalidade: Concurso Público\nBase: editais reais das principais bancas brasileiras para este cargo/área.' : ''}

Formato JSON obrigatório:
{
  "categories": [
    {
      "category": "Nome da Categoria",
      "topics": ["Subtópico específico 1", "Subtópico específico 2", ...]
    }
  ]
}

${langInstruction}. De 4 a 10 categorias, cada uma com 3 a 8 subtópicos reais e específicos.`;

  const geminiSchema = {
    type: Type.OBJECT,
    properties: {
      categories: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            topics: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              minItems: 2,
              maxItems: 10,
            },
          },
          required: ['category', 'topics'],
        },
        minItems: 4,
        maxItems: 12,
      },
    },
    required: ['categories'],
  };

  // 1. Tenta buscar do banco (curricula/{id}) — 1 read, sem IA
  const cached = await getCurriculum(subject, educationLevel);
  if (cached) {
    return {
      categories: cached.data.categories,
      providerUsed: 'db-cache',
      cacheHit: true,
    };
  }

  // 2. Não tem no banco — gera via IA
  const { data, providerUsed } = await aiOrchestrator.generateJSON({
    systemPrompt,
    userPrompt,
    schemaHint: `{ "categories": [{ "category": string, "topics": string[] }] }`,
    geminiSchema,
  });

  let categories: CurriculumCategory[] = [];
  if (Array.isArray((data as any)?.categories)) {
    categories = (data as any).categories.filter(
      (c: any) => c?.category && Array.isArray(c?.topics) && c.topics.length > 0,
    );
  }

  if (categories.length === 0) {
    throw new Error('IA não retornou categorias válidas para o currículo.');
  }

  // 3. Salva no banco para próximas requisições (assíncrono)
  saveCurriculum(subject, educationLevel, categories, providerUsed).catch(() => {});

  return { categories, providerUsed, cacheHit: false };
}
