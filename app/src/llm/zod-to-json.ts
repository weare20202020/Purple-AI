export function zodToJsonSchema(schema: any): Record<string, unknown> {
  const name = schema.constructor?.name
  if (!name) return { type: 'string' }

  switch (name) {
    case 'ZodString':
      return { type: 'string' }

    case 'ZodNumber':
      return { type: 'number' }

    case 'ZodBoolean':
      return { type: 'boolean' }

    case 'ZodEnum':
      return { type: 'string', enum: Object.values(schema._def.entries) }

    case 'ZodOptional': {
      const inner = zodToJsonSchema(schema._def.innerType)
      return inner
    }

    case 'ZodObject': {
      const shape = schema._def.shape
      if (!shape) return { type: 'object' }
      const properties: Record<string, any> = {}
      const required: string[] = []
      for (const [key, field] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(field)
        if (!(field as any).isOptional?.()) {
          required.push(key)
        }
      }
      const result: Record<string, any> = { type: 'object', properties }
      if (required.length > 0) result.required = required
      return result
    }

    case 'ZodArray': {
      const items = schema._def.element ? zodToJsonSchema(schema._def.element) : { type: 'string' }
      return { type: 'array', items }
    }

    default:
      return { type: 'string' }
  }
}
