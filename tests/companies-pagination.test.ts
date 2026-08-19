import { describe, expect, it } from 'vitest';
import { buildPageList } from '@/app/(app)/companies/page';

/** Navegacao por paginas numeradas na listagem de empresas (pedido do usuario, FASE de correcao pontual). */
describe('buildPageList', () => {
  it('mostra todas as paginas quando ha 7 ou menos', () => {
    expect(buildPageList(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildPageList(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('janela ao redor da pagina atual com "..." nos dois lados', () => {
    expect(buildPageList(10, 20)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
  });

  it('sem "..." a esquerda quando a pagina atual esta perto do inicio', () => {
    expect(buildPageList(2, 20)).toEqual([1, 2, 3, 'ellipsis', 20]);
  });

  it('sem "..." a direita quando a pagina atual esta perto do fim', () => {
    expect(buildPageList(19, 20)).toEqual([1, 'ellipsis', 18, 19, 20]);
  });

  it('sempre inclui a primeira e a ultima pagina', () => {
    const list = buildPageList(50, 100);
    expect(list[0]).toBe(1);
    expect(list[list.length - 1]).toBe(100);
  });

  it('nunca repete um numero de pagina', () => {
    const list = buildPageList(2, 20).filter((p): p is number => p !== 'ellipsis');
    expect(new Set(list).size).toBe(list.length);
  });
});
