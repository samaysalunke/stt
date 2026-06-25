import sqlParser from 'node-sql-parser';
import { getDb } from '../db';
import { assertKnownField, isReturnableColumn, quoteIdentifier, stripBlockedRows } from './schema';

type Aggregation = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
type Operator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'IN' | 'BETWEEN' | 'LIKE';

export interface StructuredAnalyticsQuery {
  intent: string;
  tables: string[];
  select: Array<{ table: string; column: string; alias?: string; aggregation?: Aggregation }>;
  filters?: Array<{ table: string; column: string; operator: Operator; value: unknown }>;
  groupBy?: Array<{ table: string; column: string }>;
  orderBy?: Array<{ table: string; column: string; direction: 'ASC' | 'DESC' }>;
  joins?: Array<{ type: 'INNER' | 'LEFT'; table: string; on: { leftCol: string; rightCol: string } }>;
  limit?: number;
}

export interface CustomQueryResult {
  columns: string[];
  rows: unknown[][];
  summary: string;
  piiAttemptDetected: boolean;
  executedSqlColumns: string[];
  truncated: boolean;
}

const { Parser } = sqlParser as any;
const parser = new Parser();
const DANGEROUS_RE = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|EXEC|EXECUTE|CREATE|REPLACE|VACUUM|ATTACH|DETACH|PRAGMA|INTO)\b/i;
const AGGREGATIONS = new Set(['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT']);
const OPERATORS = new Set(['=', '!=', '>', '<', '>=', '<=', 'IN', 'BETWEEN', 'LIKE']);

export const customQueryToolSchema = {
  name: 'analyzeCustomQuery',
  description:
    'Escape hatch for novel analytics questions no named tool covers. Express the query as a structured object (never raw SQL). The server validates the schema, strips restricted columns, compiles to parameterised read-only SQL, and executes it. Prefer named tools when one fits.',
  parameters: {
    type: 'object',
    properties: {
      intent: { type: 'string', description: 'Plain-language description of what the query computes.' },
      tables: { type: 'array', items: { type: 'string' }, description: 'Tables referenced; first is the base table.' },
      select: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            table: { type: 'string' },
            column: { type: 'string' },
            alias: { type: 'string' },
            aggregation: { type: 'string', enum: ['SUM', 'COUNT', 'AVG', 'MIN', 'MAX', 'COUNT_DISTINCT'] },
          },
          required: ['table', 'column'],
        },
      },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            table: { type: 'string' },
            column: { type: 'string' },
            operator: { type: 'string', enum: ['=', '!=', '>', '<', '>=', '<=', 'IN', 'BETWEEN', 'LIKE'] },
            value: {},
          },
          required: ['table', 'column', 'operator', 'value'],
        },
      },
      groupBy: { type: 'array', items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' } }, required: ['table', 'column'] } },
      orderBy: {
        type: 'array',
        items: { type: 'object', properties: { table: { type: 'string' }, column: { type: 'string' }, direction: { type: 'string', enum: ['ASC', 'DESC'] } }, required: ['table', 'column', 'direction'] },
      },
      joins: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['INNER', 'LEFT'] },
            table: { type: 'string' },
            on: { type: 'object', properties: { leftCol: { type: 'string' }, rightCol: { type: 'string' } }, required: ['leftCol', 'rightCol'] },
          },
          required: ['type', 'table', 'on'],
        },
      },
      limit: { type: 'number', description: 'Row cap; server enforces a maximum of 500.' },
    },
    required: ['intent', 'tables', 'select'],
  },
} as const;

export function analyzeCustomQuery(input: StructuredAnalyticsQuery): CustomQueryResult {
  validateShape(input);
  const sanitized = sanitizeStructuredQuery(input);
  if (sanitized.query.select.length === 0 && (sanitized.query.groupBy?.length ?? 0) === 0) {
    throw Object.assign(new Error('This query would only return restricted fields'), { piiAttemptDetected: sanitized.piiAttemptDetected });
  }
  const compiled = compileQuery(sanitized.query);
  validateSelectOnly(compiled.sql);
  const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));
  const rows = getDb().prepare(`${compiled.sql} LIMIT ?`).all(...compiled.params, limit + 1) as Record<string, any>[];
  const truncated = rows.length > limit;
  const keptRows = truncated ? rows.slice(0, limit) : rows;
  const columns = keptRows[0] ? Object.keys(keptRows[0]) : compiled.outputColumns;
  const values = keptRows.map((row) => columns.map((column) => row[column]));
  const stripped = stripBlockedRows(columns, values);
  return {
    columns: stripped.columns,
    rows: stripped.rows,
    summary: truncated
      ? 'Showing first 500 results - refine your question for a more specific view.'
      : `Custom analytics query executed for: ${input.intent}`,
    piiAttemptDetected: sanitized.piiAttemptDetected || stripped.stripped,
    executedSqlColumns: compiled.outputColumns,
    truncated,
  };
}

function validateShape(input: StructuredAnalyticsQuery): void {
  if (!input || typeof input !== 'object') throw new Error('Query could not be safely executed');
  if (!Array.isArray(input.tables) || input.tables.length === 0) throw new Error('Query could not be safely executed');
  if (!Array.isArray(input.select)) throw new Error('Query could not be safely executed');
  for (const table of input.tables) {
    if (typeof table !== 'string') throw new Error('Query could not be safely executed');
  }
  for (const item of input.select) assertKnownField(item.table, item.column);
  for (const item of input.select) {
    if (item.aggregation && !AGGREGATIONS.has(item.aggregation)) throw new Error('Query could not be safely executed');
  }
  for (const item of input.filters ?? []) {
    assertKnownField(item.table, item.column);
    if (!OPERATORS.has(item.operator)) throw new Error('Query could not be safely executed');
  }
  for (const item of input.groupBy ?? []) assertKnownField(item.table, item.column);
  for (const item of input.orderBy ?? []) {
    assertKnownField(item.table, item.column);
    if (item.direction !== 'ASC' && item.direction !== 'DESC') throw new Error('Query could not be safely executed');
  }
  for (const join of input.joins ?? []) {
    if (!['INNER', 'LEFT'].includes(join.type)) throw new Error('Query could not be safely executed');
    assertKnownField(join.table, join.on.rightCol);
    assertKnownField(input.tables[0], join.on.leftCol);
  }
}

function sanitizeStructuredQuery(input: StructuredAnalyticsQuery): { query: StructuredAnalyticsQuery; piiAttemptDetected: boolean } {
  let piiAttemptDetected = false;
  const keepSelect = input.select.filter((item) => {
    const keep = isReturnableColumn(item.table, item.column, item.aggregation);
    if (!keep) piiAttemptDetected = true;
    return keep;
  });
  const keepFilters = (input.filters ?? []).filter((item) => {
    const keep = isReturnableColumn(item.table, item.column);
    if (!keep) piiAttemptDetected = true;
    return keep;
  });
  if ((input.filters?.length ?? 0) !== keepFilters.length) {
    throw Object.assign(new Error('Query filters restricted fields'), { piiAttemptDetected: true });
  }
  const keepGroup = (input.groupBy ?? []).filter((item) => {
    const keep = isReturnableColumn(item.table, item.column);
    if (!keep) piiAttemptDetected = true;
    return keep;
  });
  const keepOrder = (input.orderBy ?? []).filter((item) => {
    const keep = isReturnableColumn(item.table, item.column);
    if (!keep) piiAttemptDetected = true;
    return keep;
  });
  return {
    piiAttemptDetected,
    query: { ...input, select: keepSelect, filters: keepFilters, groupBy: keepGroup, orderBy: keepOrder },
  };
}

function compileQuery(input: StructuredAnalyticsQuery): { sql: string; params: unknown[]; outputColumns: string[] } {
  const params: unknown[] = [];
  const base = input.tables[0];
  assertKnownField(base, input.select[0]?.column ?? 'id');
  const select = input.select.map((item) => {
    const col = `${quoteIdentifier(item.table)}.${quoteIdentifier(item.column)}`;
    const expr = item.aggregation
      ? item.aggregation === 'COUNT_DISTINCT'
        ? `COUNT(DISTINCT ${col})`
        : `${item.aggregation}(${col})`
      : col;
    return `${expr} AS ${quoteIdentifier(item.alias || outputName(item))}`;
  });
  if (select.length === 0) select.push('COUNT(*) AS "count"');

  let sql = `SELECT ${select.join(', ')} FROM ${quoteIdentifier(base)}`;
  for (const join of input.joins ?? []) {
    if (!['INNER', 'LEFT'].includes(join.type)) throw new Error('Query could not be safely executed');
    sql += ` ${join.type} JOIN ${quoteIdentifier(join.table)} ON ${quoteIdentifier(join.table)}.${quoteIdentifier(join.on.rightCol)} = ${quoteIdentifier(base)}.${quoteIdentifier(join.on.leftCol)}`;
  }

  const where: string[] = [];
  for (const filter of input.filters ?? []) {
    const col = `${quoteIdentifier(filter.table)}.${quoteIdentifier(filter.column)}`;
    if (filter.operator === 'IN') {
      const values = Array.isArray(filter.value) ? filter.value : [filter.value];
      where.push(`${col} IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    } else if (filter.operator === 'BETWEEN') {
      const values = Array.isArray(filter.value) ? filter.value : [];
      if (values.length !== 2) throw new Error('Query could not be safely executed');
      where.push(`${col} BETWEEN ? AND ?`);
      params.push(values[0], values[1]);
    } else {
      where.push(`${col} ${filter.operator} ?`);
      params.push(filter.value);
    }
  }
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  if (input.groupBy?.length) {
    sql += ` GROUP BY ${input.groupBy.map((item) => `${quoteIdentifier(item.table)}.${quoteIdentifier(item.column)}`).join(', ')}`;
  }
  if (input.orderBy?.length) {
    sql += ` ORDER BY ${input.orderBy.map((item) => `${quoteIdentifier(item.table)}.${quoteIdentifier(item.column)} ${item.direction === 'ASC' ? 'ASC' : 'DESC'}`).join(', ')}`;
  }

  return { sql, params, outputColumns: input.select.map(outputName) };
}

function validateSelectOnly(sql: string): void {
  if (DANGEROUS_RE.test(sql.replace(/^SELECT/i, ''))) throw new Error('Query could not be safely executed');
  let ast: any;
  try {
    ast = parser.astify(sql, { database: 'sqlite' });
  } catch {
    throw new Error('Query could not be safely executed');
  }
  const statements = Array.isArray(ast) ? ast : [ast];
  if (statements.length !== 1 || statements[0]?.type !== 'select') {
    throw new Error('Query could not be safely executed');
  }
}

function outputName(item: { column: string; alias?: string; aggregation?: string }): string {
  return item.alias || (item.aggregation ? `${item.aggregation.toLowerCase()}_${item.column}` : item.column);
}
