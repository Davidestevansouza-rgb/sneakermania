# Despliegue de Edge Functions - Sistema SeS

## Prerequisitos

1. Instalar Supabase CLI:
```bash
# macOS/Linux
brew install supabase/tap/supabase

# Windows (PowerShell)
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# O descargar desde: https://github.com/supabase/cli/releases
```

2. Autenticarse con Supabase:
```bash
supabase login
```

3. Vincular el proyecto local con tu proyecto de Supabase:
```bash
cd /ruta/a/sneakermania
supabase link --project-ref TU_PROJECT_REF
```

El `PROJECT_REF` lo encuentras en tu URL de Supabase:
`https://[PROJECT_REF].supabase.co`

Por ejemplo, si tu URL es `https://ypgyfgbftfvouobmsync.supabase.co`, 
entonces tu PROJECT_REF es `ypgyfgbftfvouobmsync`.

## Configurar Secrets

Las Edge Functions necesitan la API Key de Claude (Anthropic) para funcionar.

```bash
# Configurar ANTHROPIC_API_KEY como secret
supabase secrets set ANTHROPIC_API_KEY=tu-api-key-de-anthropic
```

**Obtener API Key de Anthropic:**
1. Ve a https://console.anthropic.com/
2. Crea una cuenta o inicia sesión
3. Ve a **API Keys**
4. Crea una nueva API Key
5. Copia la key y úsala en el comando de arriba

## Desplegar la Edge Function

```bash
cd /ruta/a/sneakermania

# Desplegar la función analyze-shoe
supabase functions deploy analyze-shoe
```

Salida esperada:
```
Deploying analyze-shoe (project ref: ypgyfgbftfvouobmsync)
✓ Deployed analyze-shoe
Function URL: https://ypgyfgbftfvouobmsync.supabase.co/functions/v1/analyze-shoe
```

## Verificar el Despliegue

1. **Ver logs en tiempo real:**
```bash
supabase functions logs analyze-shoe --tail
```

2. **Probar la función desde la terminal:**
```bash
curl -i --location --request POST \
  'https://TU_PROJECT_REF.supabase.co/functions/v1/analyze-shoe' \
  --header 'Authorization: Bearer TU_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"imageUrl":"https://ejemplo.com/tenis.jpg","marca":"Nike","modelo":"Air Max"}'
```

3. **Probar desde la aplicación:**
   - Abre Sistema SeS
   - Ve a la sección **IA**
   - Sube una foto de un calzado
   - Haz clic en **Analizar con IA**
   - Si todo está correcto, verás el análisis en 5-10 segundos

## Troubleshooting

### Error: "ANTHROPIC_API_KEY no configurada"
- Ejecuta: `supabase secrets list` para ver los secrets configurados
- Si falta, configúrala: `supabase secrets set ANTHROPIC_API_KEY=tu-key`
- Re-despliega: `supabase functions deploy analyze-shoe`

### Error: "No authorization header"
- Asegúrate de que el módulo `ia.js` está enviando el header `Authorization`
- Verifica que el usuario esté autenticado en la aplicación

### Error: "Error al comunicarse con Claude API"
- Verifica que la API Key de Anthropic sea válida
- Revisa los logs: `supabase functions logs analyze-shoe --tail`
- Confirma que tienes créditos en tu cuenta de Anthropic

### La función tarda mucho o falla
- Claude API puede tardar 5-15 segundos en responder
- Asegúrate de que las imágenes no sean demasiado grandes (< 5MB)
- Revisa los logs para ver el error específico

## Actualizar la Edge Function

Si haces cambios en `supabase/functions/analyze-shoe/index.ts`:

```bash
# Re-desplegar
supabase functions deploy analyze-shoe

# Ver logs para confirmar
supabase functions logs analyze-shoe --tail
```

## Costos

- **Supabase Edge Functions:** Gratis hasta 500,000 invocaciones/mes
- **Claude API (Anthropic):**
  - Claude 3 Sonnet: ~$3 por cada 1M de tokens input
  - Cada análisis de imagen consume ~100-300 tokens
  - Aproximadamente: 3,000-10,000 análisis por $3 USD

## URL de la Edge Function

Una vez desplegada, la URL será:
```
https://TU_PROJECT_REF.supabase.co/functions/v1/analyze-shoe
```

Esta URL ya está configurada en `js/modules/ia.js`.
