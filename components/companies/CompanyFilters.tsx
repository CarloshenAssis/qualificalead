import { Filter } from 'lucide-react';
import { Button, Card, Field, Input, LinkButton, Select } from '@/components/ui';
import type { CompanyFilters as Filters } from '@/lib/validation/schemas';
import { SORT_OPTIONS } from '@/lib/companies/query';

/**
 * Filtros da SPEC 13. Formulario GET: funciona sem JavaScript e mantem
 * o estado na URL, o que faz a exportacao respeitar os mesmos filtros (SPEC 29).
 */
export function CompanyFilters({ filters }: { filters: Filters }) {
  return (
    <Card>
      <form method="get" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Buscar por nome" htmlFor="q">
            <Input id="q" name="q" defaultValue={filters.q ?? ''} placeholder="Nome da empresa" />
          </Field>

          <Field label="Cidade" htmlFor="city">
            <Input id="city" name="city" defaultValue={filters.city ?? ''} placeholder="Cidade" />
          </Field>

          <Field label="Website" htmlFor="website">
            <Select id="website" name="website" defaultValue={filters.website}>
              <option value="all">Todos</option>
              <option value="without">Sem site identificado</option>
              <option value="with">Com site</option>
            </Select>
          </Field>

          <Field label="Avaliacao minima" htmlFor="minRating">
            <Select id="minRating" name="minRating" defaultValue={filters.minRating?.toString() ?? ''}>
              <option value="">Qualquer</option>
              <option value="3">3 ou mais</option>
              <option value="3.5">3,5 ou mais</option>
              <option value="4">4 ou mais</option>
              <option value="4.5">4,5 ou mais</option>
            </Select>
          </Field>

          <Field label="Quantidade de avaliacoes" htmlFor="minReviews">
            <Select id="minReviews" name="minReviews" defaultValue={filters.minReviews?.toString() ?? ''}>
              <option value="">Qualquer</option>
              <option value="10">10 ou mais</option>
              <option value="25">25 ou mais</option>
              <option value="50">50 ou mais</option>
              <option value="100">100 ou mais</option>
            </Select>
          </Field>

          <Field label="Instagram" htmlFor="instagram">
            <Select id="instagram" name="instagram" defaultValue={filters.instagram}>
              <option value="all">Todos</option>
              <option value="found">Encontrado</option>
              <option value="not_found">Nao encontrado</option>
              <option value="high_confidence">Alta confianca</option>
              <option value="pending">Pendente de confirmacao</option>
            </Select>
          </Field>

          <Field label="Telefone" htmlFor="phone">
            <Select id="phone" name="phone" defaultValue={filters.phone}>
              <option value="all">Todos</option>
              <option value="available">Disponivel</option>
              <option value="unavailable">Indisponivel</option>
            </Select>
          </Field>

          <Field label="Score minimo" htmlFor="minScore">
            <Select id="minScore" name="minScore" defaultValue={filters.minScore?.toString() ?? ''}>
              <option value="">Qualquer</option>
              <option value="40">40 ou mais</option>
              <option value="70">70 ou mais</option>
              <option value="85">85 ou mais</option>
            </Select>
          </Field>

          <Field label="Ordenar por" htmlFor="sort">
            <Select id="sort" name="sort" defaultValue={filters.sort}>
              {Object.entries(SORT_OPTIONS).map(([key, option]) => (
                <option key={key} value={key}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Oportunidade" htmlFor="level">
            <Select id="level" name="level" defaultValue={filters.level}>
              <option value="all">Todas</option>
              <option value="EXCELENTE">Excelente</option>
              <option value="ALTA">Alta</option>
              <option value="MEDIA">Media</option>
              <option value="BAIXA">Baixa</option>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit">
            <Filter className="size-4" aria-hidden />
            Aplicar filtros
          </Button>
          <LinkButton href="/companies" variant="ghost">
            Limpar
          </LinkButton>
        </div>
      </form>
    </Card>
  );
}
