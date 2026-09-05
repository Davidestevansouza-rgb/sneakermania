import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash'
]
const geminiUrl = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BODY_BYTES = 8 * 1024 * 1024
const MAX_BASE64_CHARS = 7 * 1024 * 1024

interface AnalysisRequest {
  imageBase64?: string
  marca?: string
  modelo?: string
}

interface AnalysisResult {
  tipoCalzado: string
  marca: string
  modelo: string
  color: string
  material: string
  estadoCalzado: string
  tratamientoSugerido: string
  confianza: number
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanHint(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim().slice(0, 120)
  return v || undefined
}

function validResult(value: any): value is AnalysisResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const textFields = ['tipoCalzado', 'marca', 'modelo', 'color', 'material', 'estadoCalzado', 'tratamientoSugerido']
  if (!textFields.every((k) => typeof value[k] === 'string')) return false
  const confianza = Number(value.confianza)
  return Number.isFinite(confianza) && confianza >= 0 && confianza <= 100
}

async function callGemini(payload: any): Promise<{ response: Response; model: string }> {
  let lastResponse: Response | null = null
  let lastModel = GEMINI_MODELS[0]

  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt <= 2; attempt++) {
      const response = await fetch(`${geminiUrl(model)}?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (response.ok) return { response, model }

      lastResponse = response
      lastModel = model
      if (response.status === 404) break

      const isOverloaded = response.status === 503 || response.status === 429
      if (isOverloaded && attempt < 2) {
        await sleep(800 * Math.pow(2, attempt))
        continue
      }
      return { response, model }
    }
  }

  if (!lastResponse) throw new Error('No hay modelos de IA disponibles')
  return { response: lastResponse, model: lastModel }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), { status: 405, headers: jsonHeaders })
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Servicio de IA no configurado' }), { status: 503, headers: jsonHeaders })
    }

    const contentLength = Number(req.headers.get('content-length') || 0)
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      return new Response(JSON.stringify({ error: 'Imagen demasiado grande' }), { status: 413, headers: jsonHeaders })
    }

    const body: AnalysisRequest = await req.json()
    if (!body || typeof body.imageBase64 !== 'string') {
      return new Response(JSON.stringify({ error: 'Se requiere imageBase64' }), { status: 400, headers: jsonHeaders })
    }
    if (body.imageBase64.length > MAX_BASE64_CHARS) {
      return new Response(JSON.stringify({ error: 'Imagen demasiado grande' }), { status: 413, headers: jsonHeaders })
    }

    const matches = body.imageBase64.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/)
    if (!matches) {
      return new Response(JSON.stringify({ error: 'Formato de imagen inválido' }), { status: 400, headers: jsonHeaders })
    }

    const mediaType = matches[1].toLowerCase()
    const base64Data = matches[2].replace(/[\r\n]/g, '')
    if (!ALLOWED_IMAGE_TYPES.has(mediaType)) {
      return new Response(JSON.stringify({ error: 'Tipo de imagen no permitido' }), { status: 415, headers: jsonHeaders })
    }

    const imageContent = { inlineData: { mimeType: mediaType, data: base64Data } }
    const marca = cleanHint(body.marca)
    const modelo = cleanHint(body.modelo)
    const contextInfo: string[] = []
    if (marca) contextInfo.push(`Marca declarada: ${marca}`)
    if (modelo) contextInfo.push(`Modelo declarado: ${modelo}`)
    const context = contextInfo.length ? `\n\nContexto adicional:\n${contextInfo.join('\n')}` : ''

    const prompt = `Eres un experto en análisis de calzado deportivo. Analiza esta imagen y proporciona un análisis ESTRUCTURADO en formato JSON con los siguientes campos:\n\n{\n  "tipoCalzado": "<tipo: tenis, zapatilla, bota, sandalia, etc.>",\n  "marca": "<marca identificada o 'Desconocida'>",\n  "modelo": "<modelo específico o descripción si no es identificable>",\n  "color": "<color principal o combinación de colores>",\n  "material": "<materiales visibles: cuero, sintético, textil, mesh, etc.>",\n  "estadoCalzado": "<estado: Nuevo/Excelente/Bueno/Regular/Desgastado/Muy dañado>",\n  "tratamientoSugerido": "<tratamiento recomendado>",\n  "confianza": <número del 0 al 100>\n}${context}\n\nResponde ÚNICAMENTE con el JSON, sin texto adicional.`

    const { response: geminiResponse, model: usedModel } = await callGemini({
      contents: [{ role: 'user', parts: [imageContent, { text: prompt }] }],
      generationConfig: { maxOutputTokens: 1024, responseMimeType: 'application/json' }
    })

    if (!geminiResponse.ok) {
      const isOverloaded = geminiResponse.status === 503 || geminiResponse.status === 429
      console.error('Gemini API error:', geminiResponse.status)
      return new Response(JSON.stringify({
        error: isOverloaded
          ? 'El servicio de análisis está saturado. Intenta de nuevo en unos segundos.'
          : 'No se pudo completar el análisis con IA'
      }), { status: isOverloaded ? 503 : 502, headers: jsonHeaders })
    }

    const geminiData = await geminiResponse.json()
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''
    let parsed: any
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (!jsonMatch) throw new Error('Respuesta sin JSON')
      parsed = JSON.parse(jsonMatch[0])
    } catch (_) {
      console.error('Respuesta IA no parseable')
      return new Response(JSON.stringify({ error: 'La IA no devolvió un análisis válido. Intenta nuevamente.' }), { status: 502, headers: jsonHeaders })
    }

    if (!validResult(parsed)) {
      console.error('Respuesta IA con estructura inválida')
      return new Response(JSON.stringify({ error: 'La IA devolvió un análisis incompleto. Intenta nuevamente.' }), { status: 502, headers: jsonHeaders })
    }

    const result: AnalysisResult = {
      tipoCalzado: parsed.tipoCalzado.trim().slice(0, 120),
      marca: parsed.marca.trim().slice(0, 120),
      modelo: parsed.modelo.trim().slice(0, 160),
      color: parsed.color.trim().slice(0, 160),
      material: parsed.material.trim().slice(0, 200),
      estadoCalzado: parsed.estadoCalzado.trim().slice(0, 120),
      tratamientoSugerido: parsed.tratamientoSugerido.trim().slice(0, 500),
      confianza: Math.round(Number(parsed.confianza))
    }

    console.log(`Análisis completado con modelo: ${usedModel}`)
    return new Response(JSON.stringify(result), { headers: jsonHeaders })
  } catch (error) {
    console.error('Error en analyze-shoe:', error)
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), { status: 500, headers: jsonHeaders })
  }
})
