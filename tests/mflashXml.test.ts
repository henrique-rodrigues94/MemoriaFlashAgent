import { describe, expect, it } from 'vitest';
import { parseMflash } from '../src/server/contentAgent/importer/parseMflashXml';
import { validateMflashPackage } from '../src/server/contentAgent/importer/completoMflash';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<memoriaflash>
  <versao>1.0</versao>
  <tipo>conteudo</tipo>
  <informacoes>
    <materia>Portugues</materia>
    <nivel>medio</nivel>
    <topico>Morfologia</topico>
    <subtopico>Substantivos</subtopico>
    <idioma>pt-BR</idioma>
    <nome>Português - Morfologia - Substantivos</nome>
  </informacoes>
  <cards>
    <card>
      <id>001</id>
      <tipo>basico</tipo>
      <pergunta>O que é um substantivo?</pergunta>
      <resposta>É a palavra que nomeia seres, objetos, lugares, sentimentos ou conceitos.</resposta>
      <explicacao>Exemplos incluem casa, Brasil e felicidade.</explicacao>
      <dificuldade>facil</dificuldade>
      <tags><tag>morfologia</tag><tag>substantivo</tag></tags>
    </card>
  </cards>
</memoriaflash>`;

describe('MemoriaFlash XML v1.0', () => {
  it('reconhece e converte o formato XML oficial', () => {
    const parsed = parseMflash(xml);
    expect(parsed.format).toBe('xml');
    expect(parsed.package.manifest.format).toBe('memoriaflash');
    expect(parsed.package.manifest.formatVersion).toBe('1.0');
    expect(parsed.package.manifest.package).toBe('nivel');
    expect(parsed.package.manifest.levels).toEqual(['medio']);
    expect(parsed.package.levels[0].subjects[0].name).toBe('Portugues');
    expect(parsed.package.levels[0].subjects[0].curricula[0].topics[0].subtopics[0].cards).toHaveLength(1);
  });

  it('valida o pacote convertido sem erros', () => {
    const parsed = parseMflash(xml);
    const result = validateMflashPackage(parsed.package);
    expect(result.issues.filter(issue => issue.severity === 'error')).toHaveLength(0);
  });

  it('rejeita versão incompatível', () => {
    expect(() => parseMflash(xml.replace('<versao>1.0</versao>', '<versao>2.0</versao>'))).toThrow(/incompatível/i);
  });
});
