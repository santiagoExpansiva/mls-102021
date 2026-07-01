/// <mls fileReference="_102021_/l2/agentChangeBackend/cbSchemas.ts" enhancement="_102027_/l2/enhancementAgent"/>

// Strict JSON schemas for every agentChangeBackend tool call (the `result` shape inside the planner
// envelope status/result/questions/trace). collab-llm forces the model to satisfy these and the
// agents re-validate locally. Each schema is the contract that makes the produced .defs.ts
// self-sufficient for the .ts materialization. See spec.md (auto-suficiência) and flow.json.

const str = { type: 'string' } as const;
const bool = { type: 'boolean' } as const;
const num = { type: 'number' } as const;
const strArray = { type: 'array', items: str } as const;

function objArray(required: string[], properties: Record<string, unknown>) {
  return { type: 'array', items: { type: 'object', additionalProperties: false, required, properties } } as const;
}

// ── planning / index ───────────────────────────────────────────────────────────

export const aggregateIndexResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['aggregates'],
  properties: {
    aggregates: objArray(['aggregateId', 'rootEntity', 'embeddedMembers', 'events', 'mdmRefs'], {
      aggregateId: str,
      rootEntity: str,
      embeddedMembers: strArray, // supporting entities folded into the root details JSONB
      events: strArray,          // event entities -> own append-only tables
      mdmRefs: strArray,         // mdm entities -> read via 102034, NO local table
    }),
  },
} as const;

export const persistenceIndexResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tables'],
  properties: {
    tables: objArray(['tableId', 'rootEntity', 'ownership', 'indexedColumns', 'detailsFields', 'childCollections'], {
      tableId: str,
      rootEntity: str,
      ownership: str,
      indexedColumns: objArray(['fieldId', 'reason'], { fieldId: str, reason: str }), // real columns
      detailsFields: strArray,     // non-indexed fields -> details JSONB
      childCollections: strArray,  // embedded supporting collections in details JSONB
    }),
  },
} as const;

export const usecaseIndexResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['usecases'],
  properties: {
    usecases: objArray(['usecaseId', 'ownerId', 'ports', 'rulesApplied'], {
      usecaseId: str,
      ownerId: str,        // operationId or workflowId
      ports: strArray,     // repository ports the usecase needs
      rulesApplied: strArray,
    }),
  },
} as const;

export const bffIndexResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pages'],
  properties: {
    pages: objArray(['pageId', 'commands', 'contractRef'], {
      pageId: str,
      commands: strArray,  // bffCommand names on the page
      contractRef: str,    // l2/{module}/web/contracts/{page}.defs.ts
    }),
  },
} as const;

// ── generation / defs ───────────────────────────────────────────────────────────

const fieldSchema = { type: 'object', additionalProperties: false, required: ['fieldId', 'type', 'required'], properties: { fieldId: str, type: str, required: bool, description: str, enum: strArray } } as const;

export const domainEntityResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entityId', 'fields'],
  properties: {
    entityId: str,
    title: str,
    fields: { type: 'array', items: fieldSchema },
    valueObjects: objArray(['name', 'fields'], { name: str, fields: { type: 'array', items: fieldSchema }, collection: bool }),
    invariants: strArray,
    statusEnum: strArray,
  },
} as const;

export const repositoryPortResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entityId', 'interfaceName', 'methods'],
  properties: {
    entityId: str,
    interfaceName: str, // I{Entity}Repository
    methods: objArray(['name', 'returns'], { name: str, params: strArray, returns: str, description: str }),
  },
} as const;

export const persistenceTableResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tableId', 'tableName', 'columns', 'primaryKey'],
  properties: {
    tableId: str,
    tableName: str, // snake_case
    columns: objArray(['name', 'type', 'nullable'], { name: str, type: str, nullable: bool, description: str }),
    primaryKey: strArray,
    indexes: objArray(['indexName', 'columns'], { indexName: str, columns: strArray, unique: bool }),
    detailsColumn: { type: 'object', additionalProperties: false, required: ['enabled'], properties: { enabled: bool, columnName: str, childCollections: strArray } },
    // Append-only event tables: appendOnly=true, purpose 'controle' (telemetry/audit), retentionDays
    // carried to the TableDefinition (omitted = permanent). Absent for normal aggregate tables.
    appendOnly: bool,
    purpose: str,
    retentionDays: num,
  },
} as const;

export const repositoryAdapterResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['entityId', 'className', 'portRef', 'tableRef'],
  properties: {
    entityId: str,
    className: str,
    portRef: str,  // .d.ts of the port it implements
    tableRef: str, // .d.ts of the table it maps to
    mdmReads: strArray,
    notes: strArray,
  },
} as const;

// A usecase file may export SEVERAL functions, each with its OWN explicit Input/Output FIELDS (not
// just type names) so the .ts and the BFF that imports it are deterministic.
const ioFieldSchema = { type: 'object', additionalProperties: false, required: ['name', 'type'], properties: { name: str, type: str, required: bool, description: str, ofEntity: str } } as const;

const usecaseFunctionSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['functionName', 'inputTypeName', 'outputTypeName', 'input', 'output'],
  properties: {
    functionName: str,
    inputTypeName: str,
    outputTypeName: str,
    input: { type: 'array', items: ioFieldSchema },   // explicit input fields (camelCase)
    output: { type: 'array', items: ioFieldSchema },  // explicit output fields (camelCase)
    ports: strArray,          // ports this function uses
    rulesApplied: strArray,
    transactional: bool,
    steps: strArray,
  },
} as const;

export const usecaseResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['usecaseId', 'ports', 'functions'],
  properties: {
    usecaseId: str,
    ports: strArray,          // all repository ports the usecase file imports (union of functions)
    rulesApplied: strArray,
    functions: { type: 'array', items: usecaseFunctionSchema },  // 1..N exported functions
  },
} as const;

export const httpControllerResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pageId', 'controllerName', 'handlers', 'routes'],
  properties: {
    pageId: str,
    controllerName: str,
    handlers: objArray(['handlerName', 'command', 'usecaseRef'], { handlerName: str, command: str, usecaseRef: str, kind: str }),
    routes: objArray(['key', 'handlerName'], { key: str, handlerName: str }), // key = {module}.{page}.{command}
  },
} as const;

export const finalSummaryResultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: { summary: str, ownersDone: strArray, warnings: strArray },
} as const;
