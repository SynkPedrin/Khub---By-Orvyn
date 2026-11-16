import { z } from 'zod';

/**
 * Zod (v3) → JSON Schema para o `inputSchema` das tools do MCP. Cobre o que as
 * tools do KHUB usam — objeto, texto, número, booleano, enum, lista, registro
 * livre, opcional/default — e carrega o `.describe()` de cada campo (é o que o
 * Claude/ChatGPT leem para preencher certo). Tipo desconhecido LANÇA: schema
 * errado em silêncio faz o modelo mandar argumento que o servidor recusa.
 */
export function paraJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = schema._def as { typeName: z.ZodFirstPartyTypeKind; description?: string };
  const com = (s: Record<string, unknown>) => (def.description ? { ...s, description: def.description } : s);
  const K = z.ZodFirstPartyTypeKind;

  switch (def.typeName) {
    case K.ZodObject: {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [chave, campo] of Object.entries(shape)) {
        properties[chave] = paraJsonSchema(campo as z.ZodTypeAny);
        if (!(campo as z.ZodTypeAny).isOptional()) required.push(chave);
      }
      return com({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });
    }
    case K.ZodString: {
      const s: Record<string, unknown> = { type: 'string' };
      for (const c of (schema as z.ZodString)._def.checks) {
        if (c.kind === 'min') s.minLength = c.value;
        if (c.kind === 'max') s.maxLength = c.value;
        if (c.kind === 'uuid') s.format = 'uuid';
        if (c.kind === 'url') s.format = 'uri';
        if (c.kind === 'email') s.format = 'email';
      }
      return com(s);
    }
    case K.ZodNumber: {
      const s: Record<string, unknown> = { type: 'number' };
      for (const c of (schema as z.ZodNumber)._def.checks) {
        if (c.kind === 'int') s.type = 'integer';
        if (c.kind === 'min') s.minimum = c.value;
        if (c.kind === 'max') s.maximum = c.value;
      }
      return com(s);
    }
    case K.ZodBoolean:
      return com({ type: 'boolean' });
    case K.ZodEnum:
      return com({ type: 'string', enum: [...(schema as z.ZodEnum<[string, ...string[]]>).options] });
    case K.ZodLiteral:
      return com({ const: (schema as z.ZodLiteral<unknown>).value });
    case K.ZodArray: {
      const a = schema as z.ZodArray<z.ZodTypeAny>;
      const s: Record<string, unknown> = { type: 'array', items: paraJsonSchema(a.element) };
      if (a._def.minLength) s.minItems = a._def.minLength.value;
      if (a._def.maxLength) s.maxItems = a._def.maxLength.value;
      return com(s);
    }
    case K.ZodRecord:
      return com({ type: 'object', additionalProperties: paraJsonSchema((schema as z.ZodRecord)._def.valueType) });
    case K.ZodUnknown:
    case K.ZodAny:
      return com({});
    case K.ZodOptional:
    case K.ZodNullable:
      return com(paraJsonSchema((schema._def as { innerType: z.ZodTypeAny }).innerType));
    case K.ZodDefault: {
      const d = schema._def as { innerType: z.ZodTypeAny; defaultValue: () => unknown };
      return com({ ...paraJsonSchema(d.innerType), default: d.defaultValue() });
    }
    case K.ZodEffects:
      return com(paraJsonSchema((schema._def as { schema: z.ZodTypeAny }).schema));
    default:
      throw new Error(`tipo zod sem conversão para JSON Schema: ${def.typeName}`);
  }
}
