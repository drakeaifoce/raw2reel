import authSchema from './auth-schema.json'
import { config } from './config'

type Schema = Record<string, unknown>
const string = { type: 'string' }
const object = (properties: Schema, required = Object.keys(properties)): Schema => ({
  type: 'object',
  properties,
  required,
})
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const response = (description: string, schema?: Schema) => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
})
const body = (schema: Schema) => ({ required: true, content: { 'application/json': { schema } } })
const parameter = (name: string, location: string, required = true) => ({
  name,
  in: location,
  required,
  schema: string,
})
const credentials = object({ email: string, password: { ...string, format: 'password' } })
const empty = { ...object({}), additionalProperties: false }
const refresh = { ...object({ refreshToken: string }), additionalProperties: false }
const mediaSecurity = [{ accessBearer: [] }, { sessionCookie: [] }]
const commonErrors = {
  '400': response('Invalid input or mixed credential transports', ref('Error')),
  '401': response('Missing, expired or revoked credential', ref('Error')),
  '503': response('Required service is not configured', ref('Error')),
}
const identityErrors = {
  '400': response('INVALID_REQUEST', ref('IdentityError')),
  '401': response('INVALID_CREDENTIAL', ref('IdentityError')),
  '403': response('ORIGIN_REJECTED or CSRF_REJECTED', ref('IdentityError')),
  '409': response('SESSION_EXISTS or ACCOUNT_TRANSITION', ref('IdentityError')),
  '429': response('RATE_LIMITED; carries Retry-After in seconds', ref('IdentityError')),
  '503': response('Dependency unavailable', ref('Error')),
  default: response(
    'Unhandled dependency or registration failure; body is not a stable JSON contract',
  ),
}

export function createOpenAPI() {
  const paths: Record<string, unknown> = {
    '/health': {
      get: {
        summary: 'Process liveness',
        responses: {
          '200': response('Alive', object({ status: { type: 'string', enum: ['ok'] } })),
        },
      },
    },
    '/version': {
      get: {
        summary: 'Deployed build version',
        responses: { '200': response('Version', object({ service: string, version: string })) },
      },
    },
    '/ready': {
      get: {
        summary: 'Mongo and Blob readiness',
        description: 'Unconfigured dependencies do not make readiness fail.',
        responses: {
          '200': response('Ready', ref('Readiness')),
          '503': response('Dependency error', ref('Readiness')),
        },
      },
    },
    '/media': {
      get: {
        summary: 'List only the current owner’s media',
        security: mediaSecurity,
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        ],
        responses: {
          ...commonErrors,
          '200': response(
            'Owned files; foreign and legacy ownerless records are excluded',
            object({ items: { type: 'array', items: ref('Media') } }),
          ),
        },
      },
      post: {
        summary: 'Upload a file owned by the authenticated guest or registered user',
        security: mediaSecurity,
        description: `Multipart is buffered in memory. Maximum file size: ${config.maxMediaSizeBytes} bytes. Allowed MIME patterns: ${config.mediaAllowedTypes.join(', ')}. Cookie and bearer credentials must not be mixed.`,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: object({ file: { type: 'string', format: 'binary' } }),
            },
          },
        },
        responses: {
          ...commonErrors,
          '201': response('Uploaded file metadata', ref('Media')),
          '413': response('File/request too large', ref('Error')),
          '415': response('MIME type not allowed', ref('Error')),
        },
      },
    },
    '/analyses': {
      post: {
        summary: 'Queue character discovery for an owned video',
        description:
          'Returns immediately with an analysis id: discovery calls cloud models and takes minutes. Poll GET /analyses/{id} until status is done, then render the chosen people.',
        security: mediaSecurity,
        requestBody: body({
          ...object({ sourceMediaId: string }),
          additionalProperties: false,
        }),
        responses: {
          ...commonErrors,
          '202': {
            description: 'Analysis accepted; Location points at the status resource',
            headers: { Location: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: ref('Analysis') } },
          },
          '404': response('Source media is missing or foreign', ref('Error')),
        },
      },
    },

    '/analyses/{id}': {
      get: {
        summary: 'Read an owned analysis and its character cards',
        security: mediaSecurity,
        parameters: [parameter('id', 'path')],
        responses: {
          ...commonErrors,
          '200': {
            description: 'Current state; people are filled once status is done',
            content: { 'application/json': { schema: ref('Analysis') } },
          },
          '404': response('Missing or foreign analysis (indistinguishable)', ref('Error')),
        },
      },
    },

    '/analyses/{id}/people/{personId}/thumbnail': {
      get: {
        summary: 'Stream one character preview from an owned analysis',
        description:
          'A bounded JPEG, at most 256x256. Previews are served as separate files so polling the analysis stays cheap.',
        security: mediaSecurity,
        parameters: [parameter('id', 'path'), parameter('personId', 'path')],
        responses: {
          ...commonErrors,
          '200': {
            description: 'JPEG bytes. nosniff; CSP default-src none; sandbox.',
            content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
          },
          '404': response('Missing analysis, person, or preview', ref('Error')),
        },
      },
    },

    '/renders': {
      post: {
        summary: 'Queue a reel render for an owned video',
        description:
          'Returns immediately with a job id: the render itself takes minutes and runs in a worker. Poll GET /renders/{id} for the outcome.',
        security: mediaSecurity,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description:
                  'Provide analysisId (optionally with personIds) to render a reviewed catalog, or sourceMediaId alone to let the worker prepare it and pick the most observed people.',
                oneOf: [{ required: ['analysisId'] }, { required: ['sourceMediaId'] }],
                properties: {
                  analysisId: {
                    type: 'string',
                    description: 'A done analysis owned by the caller',
                  },
                  personIds: {
                    type: 'array',
                    items: { type: 'string' },
                    minItems: 1,
                    maxItems: 16,
                    description: 'Catalog ids to keep; requires analysisId. Omitted means all.',
                  },
                  sourceMediaId: { type: 'string' },
                  musicMediaId: { type: 'string' },
                  duration: {
                    type: 'number',
                    exclusiveMinimum: 0,
                    maximum: 30,
                    default: 27,
                    description: 'Result duration in seconds',
                  },
                  captions: { type: 'boolean', default: true },
                },
                additionalProperties: false,
              },
            },
          },
        },
        responses: {
          ...commonErrors,
          '202': {
            description: 'Job accepted; Location points at the status resource',
            headers: { Location: { schema: { type: 'string' } } },
            content: { 'application/json': { schema: ref('RenderJob') } },
          },
          '404': response('Source, music or analysis is missing or foreign', ref('Error')),
          '409': response(
            'ANALYSIS_NOT_READY or ANALYSIS_HAS_NO_PEOPLE: nothing to render yet',
            ref('Error'),
          ),
        },
      },
    },

    '/renders/{id}': {
      get: {
        summary: 'Read the state of an owned render job',
        security: mediaSecurity,
        parameters: [parameter('id', 'path')],
        responses: {
          ...commonErrors,
          '200': {
            description: 'Current job state; resultMediaId appears once status is done',
            content: { 'application/json': { schema: ref('RenderJob') } },
          },
          '404': response('Missing or foreign job (indistinguishable)', ref('Error')),
        },
      },
    },

    '/media/{id}': {
      get: {
        summary: 'Stream an owned file',
        security: mediaSecurity,
        parameters: [parameter('id', 'path')],
        responses: {
          ...commonErrors,
          '200': {
            description:
              'Original MIME and bytes. nosniff; CSP default-src none; sandbox. No range contract.',
            content: {
              'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
              'video/*': { schema: { type: 'string', format: 'binary' } },
              'image/*': { schema: { type: 'string', format: 'binary' } },
              'audio/*': { schema: { type: 'string', format: 'binary' } },
            },
          },
          '404': response(
            'Missing, foreign, or legacy ownerless ID (indistinguishable)',
            ref('Error'),
          ),
        },
      },
    },
    '/db/hello': {
      get: {
        summary: 'Authenticated database diagnostic (writes an upsert)',
        description:
          'This GET is not read-only. Requires a valid bound Better Auth session; bearer alone is not accepted.',
        security: [{ sessionCookie: [] }],
        responses: {
          ...commonErrors,
          '200': response('Database message', object({ message: string })),
        },
      },
    },
    '/auth/get-session': {
      get: {
        ...authSchema.session.get,
        security: [{ sessionCookie: [] }],
        description:
          'Better Auth session introspection. Generated from the installed Better Auth version. This alone does not prove media authority: identity binding is also enforced.',
      },
    },
    '/auth/sign-out': {
      post: {
        summary: 'Sign out the bound Better Auth session and revoke its identity family',
        security: [{ sessionCookie: [] }],
        description:
          'Better Auth Origin/CSRF validation applies. Prefer identity/web/logout to also clear the refresh cookie.',
        responses: {
          ...commonErrors,
          '200': response('Signed out', object({ success: { type: 'boolean' } })),
          '403': response('Origin/CSRF rejected'),
        },
      },
    },
  }
  for (const transport of ['api', 'web']) {
    const web = transport === 'web'
    for (const operation of [
      'guest',
      'sign-in',
      'sign-up',
      'refresh',
      'logout',
      ...(web ? ['csrf'] : []),
    ]) {
      const signup = operation === 'sign-up'
      const protectedWeb = web && ['refresh', 'logout', 'csrf'].includes(operation)
      const parameters = web
        ? [
            parameter('Origin', 'header'),
            ...(['refresh', 'logout'].includes(operation)
              ? [parameter('X-CSRF-Token', 'header')]
              : signup
                ? [parameter('X-CSRF-Token', 'header', false)]
                : []),
          ]
        : []
      const schema =
        operation === 'sign-in'
          ? { ...credentials, additionalProperties: false }
          : signup
            ? {
                ...object({
                  email: string,
                  password: { ...string, format: 'password' },
                  name: string,
                  mode: { type: 'string', enum: ['new', 'upgrade'] },
                }),
                additionalProperties: false,
              }
            : !web && ['refresh', 'logout'].includes(operation)
              ? refresh
              : empty
      paths[`/identity/${transport}/${operation}`] = {
        post: {
          summary: `${transport}: ${operation}`,
          description: `${web ? 'Requires an allowed Origin. Refresh is an HttpOnly Secure SameSite=Lax cookie, never returned in JSON. Bootstrap CSRF again after rotation.' : 'Non-browser API: Origin is rejected (403), Cookie is rejected (400). Refresh is returned in JSON.'} ${signup ? 'mode is mandatory. upgrade requires guest access bearer (API), or refresh cookie plus X-CSRF-Token (web); loss of proof never falls back to new. Retry the same input for bounded durable recovery; foreign ownership is never transferred. new rejects an existing identity credential.' : ''} ${operation === 'refresh' ? 'Single-use rotation. Reuse revokes the family. Refresh does not extend absolute expiry or count as activity.' : ''} ${operation === 'logout' ? 'Revokes the family, does not delete user data.' : ''}`,
          security: protectedWeb
            ? [{ refreshCookie: [] }]
            : signup
              ? [{}, web ? { refreshCookie: [] } : { accessBearer: [] }]
              : [],
          parameters,
          requestBody: body(schema),
          responses: {
            ...identityErrors,
            [operation === 'guest' ? '201' : operation === 'logout' ? '204' : '200']: response(
              'Success',
              operation === 'logout'
                ? undefined
                : operation === 'csrf'
                  ? object({ csrfToken: string })
                  : signup
                    ? {
                        allOf: [
                          ref(web ? 'WebTokenPair' : 'TokenPair'),
                          object(
                            {
                              status: { type: 'string', enum: ['completed'] },
                              operationId: string,
                            },
                            ['status'],
                          ),
                        ],
                      }
                    : ref(web ? 'WebTokenPair' : 'TokenPair'),
            ),
          },
        },
      }
    }
  }
  for (const operation of ['activity', 'revoke-all'])
    paths[`/identity/${operation}`] = {
      post: {
        summary:
          operation === 'activity'
            ? 'Record explicit user activity'
            : 'Revoke all identity families',
        description:
          operation === 'activity'
            ? 'Updates lastActiveAt only for an active owner with a valid bearer. Media access and background refresh do not automatically touch activity.'
            : 'Invalidates all identity credentials via the owner epoch. Does not delete files.',
        security: [{ accessBearer: [] }],
        responses: { ...identityErrors, '204': response('Accepted') },
      },
    }
  const tokenProperties = {
    accessToken: string,
    familyId: string,
    expiresIn: { type: 'integer', description: 'Access lifetime in seconds; default 900' },
    refreshExpiresAt: {
      type: 'string',
      format: 'date-time',
      description: 'Absolute family expiry; default 30 days, not extended by refresh',
    },
    tokenType: { type: 'string', enum: ['Bearer'] },
    user: object({ id: string, isAnonymous: { type: 'boolean' } }),
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Raw2Reel API',
      version: '1.0.0',
      description:
        'Public /api is stripped by Caddy. Guest and registered identities access only owned media. Raw Better Auth email endpoints are not a substitute for identity issuance. Cleanup is not implemented or scheduled; >24h guest inactivity is a future deletion policy, not current automatic deletion.',
    },
    // Resolved against /api/openapi.json externally, /openapi.json directly.
    servers: [{ url: './' }],
    paths,
    components: {
      securitySchemes: {
        accessBearer: {
          type: 'http',
          scheme: 'bearer',
          description: 'Opaque identity access token (not a JWT)',
        },
        sessionCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Secure-better-auth.session_token',
          description:
            'HTTPS Better Auth session. HTTP development uses better-auth.session_token. Identity family binding is also required.',
        },
        refreshCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: '__Host-r2r-refresh',
          description: 'HttpOnly Secure refresh; web requires Origin and CSRF where specified.',
        },
      },
      schemas: {
        ...authSchema.schemas,
        Error: object({ error: string, code: string }),
        IdentityError: object({ error: object({ code: string, message: string }) }),
        RenderJob: object(
          {
            id: string,
            status: { type: 'string', enum: ['queued', 'rendering', 'done', 'failed'] },
            duration: { type: 'number' },
            captions: { type: 'boolean' },
            musicMediaId: string,
            analysisId: string,
            personIds: { type: 'array', items: string },
            resultMediaId: string,
            error: string,
            createdAt: string,
            updatedAt: string,
          },
          ['id', 'status', 'createdAt', 'updatedAt'],
        ),
        AnalysisPerson: object(
          {
            id: string,
            label: { ...string, description: 'Anonymous label, never a real name' },
            observationCount: {
              type: 'integer',
              minimum: 0,
              description: 'How often the person was seen; drives automatic selection',
            },
            thumbnailUrl: {
              ...string,
              description:
                'Path to the JPEG preview, relative to this API root: the public prefix is /api, so prepend it (/api/analyses/...). Absent when no usable preview exists.',
            },
          },
          ['id', 'label', 'observationCount'],
        ),
        Analysis: object(
          {
            id: string,
            sourceMediaId: string,
            status: { type: 'string', enum: ['queued', 'preparing', 'done', 'failed'] },
            people: { type: 'array', items: ref('AnalysisPerson') },
            sourceDuration: { type: 'number' },
            warnings: { type: 'array', items: string },
            error: string,
            createdAt: string,
            updatedAt: string,
          },
          ['id', 'sourceMediaId', 'status', 'people', 'createdAt', 'updatedAt'],
        ),
        Media: object({
          id: string,
          name: string,
          type: string,
          size: { type: 'integer', minimum: 0 },
          createdAt: { type: 'string', format: 'date-time' },
        }),
        Readiness: object({
          ready: { type: 'boolean' },
          dependencies: {
            type: 'object',
            additionalProperties: object(
              { state: { type: 'string', enum: ['ok', 'unconfigured', 'error'] }, detail: string },
              ['state'],
            ),
          },
        }),
        TokenPair: object({ ...tokenProperties, refreshToken: string }),
        WebTokenPair: object({
          ...tokenProperties,
          refreshTransport: { type: 'string', enum: ['cookie'] },
        }),
      },
    },
  }
}
