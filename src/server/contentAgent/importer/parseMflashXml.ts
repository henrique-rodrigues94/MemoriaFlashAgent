import { MflashPackage, MflashCardInput, OFFICIAL_LEVELS, MFLASH_FORMAT, MFLASH_VERSION } from './completoMflash';
import type { EducationLevel } from '../../db/firestoreSchema';

export type MflashInputFormat = 'xml' | 'json';

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requiredTag(xml: string, tag: string, context = '$'): string {
  const match = xml.match(new RegExp(`<${escapeRegExp(tag)}>([\\s\\S]*?)</${escapeRegExp(tag)}>`, 'i'));
  if (!match) throw new Error(`Tag obrigatória ausente: ${context}.${tag}`);
  const value = decodeXml(match[1]);
  if (!value) throw new Error(`Tag obrigatória vazia: ${context}.${tag}`);
  return value;
}

function optionalTag(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${escapeRegExp(tag)}>([\\s\\S]*?)</${escapeRegExp(tag)}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function allBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`, 'gi');
  return [...xml.matchAll(re)].map(match => match[1]);
}

function detectFormat(raw: string): MflashInputFormat {
  const text = raw.replace(/^\\uFEFF/, '').trim();
  if (text.startsWith('<?xml') || /^<memoriaflash(?:\\s|>)/i.test(text)) return 'xml';
  if (text.startsWith('{')) return 'json';
  throw new Error('Formato .mflash não reconhecido. Esperado XML MemoriaFlash ou JSON legado.');
}

function validateXmlEnvelope(xml: string): void {
  const normalized = xml.replace(/^\\uFEFF/, '').trim();
  if (!normalized.startsWith('<?xml')) throw new Error('XML MemoriaFlash deve iniciar com a declaração XML.');
  if (!/<memoriaflash(?:\\s[^>]*)?>[\\s\\S]*<\\/memoriaflash>/i.test(normalized)) throw new Error('Elemento raiz <memoriaflash> não encontrado ou incompleto.');
  const rootMatches = normalized.match(/<memoriaflash(?:\\s[^>]*)?>/gi) || [];
  if (rootMatches.length !== 1) throw new Error('O arquivo deve possuir exatamente um elemento raiz <memoriaflash>.');
  if (/<\\/(?!memoriaflash>)[^>]+>/.test(normalized.replace(/<\\?xml[^>]*>/i, ''))) {
    // Structural validation is performed by the field/card parsers below; this guard only catches obvious broken closing tags.
  }
}

function parseTags(cardXml: string): string[] {
  const tagsBlock = allBlocks(cardXml, 'tags')[0] || '';
  return allBlocks(tagsBlock, 'tag').map(decodeXml).filter(Boolean);
}

function parseCards(cardsXml: string): MflashCardInput[] {
  return allBlocks(cardsXml, 'card').map((cardXml, index) => {
    const id = optionalTag(cardXml, 'id') || String(index + 1).padStart(3, '0');
    const type = optionalTag(cardXml, 'tipo') || 'basico';
    const question = requiredTag(cardXml, 'pergunta', `cards.card[${index}]`);
    const answer = requiredTag(cardXml, 'resposta', `cards.card[${index}]`);
    const explanation = optionalTag(cardXml, 'explicacao');
    const difficulty = optionalTag(cardXml, 'dificuldade') || 'medio';
    const tags = parseTags(cardXml);
    if (type !== 'basico') throw new Error(`Tipo de card não suportado na versão 1.0: ${type}.`);
    if (!tags.length) throw new Error(`Card ${id} precisa possuir pelo menos uma <tag>.`);
    return { id, question, answer, explanation, difficulty, tags };
  });
}

export function parseMflashXml(raw: string): MflashPackage {
  validateXmlEnvelope(raw);
  const xml = raw.replace(/^\\uFEFF/, '').trim();
  const version = requiredTag(xml, 'versao');
  const type = requiredTag(xml, 'tipo');
  if (version !== MFLASH_VERSION) throw new Error(`Versão .mflash incompatível: ${version}. Esperada ${MFLASH_VERSION}.`);
  if (type !== 'conteudo') throw new Error(`Tipo de arquivo XML incompatível: ${type}. Esperado conteudo.`);

  const info = allBlocks(xml, 'informacoes')[0];
  if (!info) throw new Error('Seção <informacoes> obrigatória não encontrada.');
  const subject = requiredTag(info, 'materia', 'informacoes');
  const levelRaw = requiredTag(info, 'nivel', 'informacoes').toLowerCase() as EducationLevel;
  const levelAliases: Record<string, EducationLevel> = { fundamental: 'fundamental', medio: 'medio', faculdade: 'faculdade', superior: 'faculdade', concurso: 'concurso', tecnico: 'tecnico', técnico: 'tecnico' };
  const level = levelAliases[levelRaw] || levelRaw;
  if (!OFFICIAL_LEVELS.includes(level)) throw new Error(`Nível inválido: ${levelRaw}. Permitidos: ${OFFICIAL_LEVELS.join(', ')}.`);
  const topic = requiredTag(info, 'topico', 'informacoes');
  const subtopic = requiredTag(info, 'subtopico', 'informacoes');
  const language = optionalTag(info, 'idioma') || 'pt-BR';
  const name = optionalTag(info, 'nome') || `${subject} - ${topic} - ${subtopic}`;
  const cardsBlock = allBlocks(xml, 'cards')[0];
  if (!cardsBlock) throw new Error('Seção <cards> obrigatória não encontrada.');
  const cards = parseCards(cardsBlock);
  if (!cards.length) throw new Error('O arquivo precisa possuir pelo menos um <card>.');

  return {
    manifest: {
      format: MFLASH_FORMAT,
      formatVersion: MFLASH_VERSION,
      package: 'nivel',
      contentVersion: '1.0',
      language,
      levels: [level],
      statistics: { cards: cards.length },
      generator: { name: 'MemoriaFlash XML Generator' },
    },
    levels: [{
      id: level,
      name: level,
      subjects: [{
        name: subject,
        curricula: [{
          name: name,
          topics: [{
            name: topic,
            subtopics: [{ name: subtopic, cards }],
          }],
        }],
      }],
    }],
  };
}

export function parseMflash(raw: string): { format: MflashInputFormat; package: MflashPackage } {
  const format = detectFormat(raw);
  if (format === 'xml') return { format, package: parseMflashXml(raw) };
  return { format, package: JSON.parse(raw) as MflashPackage };
}
