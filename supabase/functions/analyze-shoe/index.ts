// Edge Function: analyze-shoe (corregida)
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// GPIO: se eliminó el import de @supabase/supabase-js porque no se usa en el código
// eso evita un cold-start costoso en esm.sh

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('ANTHROPIC_API_KEY')
const GEMINI_MODEL = 'gemini-2.0-flash-001' // Modelo válido actual de Gemini
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

interface AnalysisRequest {
  imageUrl?: string
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
  raw?: any
}

// Convierte ArrayBuffer a base64 sin usar spread (evita stack overflow con imágenes grandes)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000 // 32KB por chunk
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: jsonHeaders
      })
    }

    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({
        error: 'GEMINI_API_KEY no configurada en Supabase Edge Functions'
      }), {
        status: 500,
        headers: jsonHeaders
      })
    }

    const body: AnalysisRequest = await req.json()

    let imageContent: any

    if (body.imageUrl) {
      const imageResponse = await fetch(body.imageUrl)
      if (!imageResponse.ok) {
        throw new Error('No se pudo descargar la imagen')
      }
      const imageBlob = await imageResponse.blob()
      const imageBuffer = await imageBlob.arrayBuffer()
      const imageBase64 = arrayBufferToBase64(imageBuffer)

      imageContent = {
        inlineData: {
          mimeType: imageBlob.type || 'image/jpeg',
          data: imageBase64
        }
      }
    } else if (body.imageBase64) {
      const matches = body.imageBase64.match(/^data:([^;]+);base64,(.+)$/)
      const mediaType = matches ? matches[1] : 'image/jpeg'
      const base64Data = matches ? matches[2] : body.imageBase64

      imageContent = {
        inlineData: {
          mimeType: mediaType,
          data: base64Data
        }
      }
    } else {
      return new Response(JSON.stringify({
        error: 'Se requiere imageUrl o imageBase64'
      }), {
        status: 400,
        headers: jsonHeaders
      })
    }

    const contextInfo = []
    if (body.marca) contextInfo.push(`Marca declarada: ${body.marca}`)
    if (body.modelo) contextInfo.push(`Modelo declarado: ${body.modelo}`)
    const context = contextInfo.length > 0
      ? `\n\nContexto adicional:\n${contextInfo.join('\n')}`
      : ''

    const prompt = `Eres un experto en análisis de calzado deportivo. Analiza esta imagen y proporciona un análisis ESTRUCTURADO en formato JSON con los siguientes campos:

{
  "tipoCalzado": "<​tipo: tenis, zapatilla, bota, sandalia, etc.>",
  "marca": "<​marca identificada o 'Desconocida'>",
  "modelo": "<​modelo específico o descripción si no es identificable>",
  "color": "<​color principal o combinación de colores>",
  "material": "<​materiales visibles: cuero, sintético, textil, mesh, etc.>",
  "estadoCalzado": "<​estado: Nuevo/Excelente/Bueno/Regular/Desgastado/Muy dañado>",
  "tratamientoSugerido": "<​tratamiento recomendado: Limpieza profunda, Restauración de color, Cambio de suela, etc.>",
  "confianza": <número del 0 al 100 indicando tu nivel de confianza en el análisis>
}${context}

Responde ÚNICAMENTE con el JSON, sin texto adicional.`

    const geminiResponse = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              imageContent,
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      })
    })

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text()
      console.error('Gemini API error:', errorText)
      return new Response(JSON.stringify({
        error: 'Error al comunicarse con Gemini API',
        details: errorText
      }), {
        status: geminiResponse.status,
        headers: jsonHeaders
      })
    }

    const geminiData = await geminiResponse.json()
    const responseText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''

    let result: AnalysisResult
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No se encontró JSON en la respuesta')
      }
    } catch (parseError) {
      result = {
        tipoCalzado: 'Tenis deportivo',
        marca: body.marca || 'Desconocida',
        modelo: body.modelo || 'No identificado',
        color: 'Múltiple',
        material: 'Sintético/Textil',
        estadoCalzado: 'Bueno',
        tratamientoSugerido: 'Limpieza básica',
        confianza: 50,
        raw: responseText
      }
    }

    return new Response(JSON.stringify(result), {
      headers: jsonHeaders
    })

  } catch (error) {
    console.error('Error en analyze-shoe:', error)
    return new Response(JSON.stringify({
      error: error.message || 'Error interno del servidor'
    }), {
      status: 500,
      headers: jsonHeaders
    })
  }
})