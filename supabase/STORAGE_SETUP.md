# Configuración de Supabase Storage para Sistema SeS

## 1. Crear el bucket 'fotos'

1. Ve a tu proyecto en Supabase Dashboard
2. Navega a **Storage** en el menú lateral
3. Haz clic en **New Bucket**
4. Configura:
   - **Name:** `fotos`
   - **Public bucket:** ✅ Marcado (para URLs públicas)
   - **File size limit:** 5MB (ajustable según necesidad)
   - **Allowed MIME types:** `image/*` (solo imágenes)

## 2. Políticas de seguridad (RLS)

Ejecuta el siguiente SQL en el **SQL Editor** para configurar las políticas de acceso:

```sql
-- Política: Los usuarios solo pueden subir archivos a su tenant
CREATE POLICY "Users can upload to own tenant"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'fotos' 
  AND (storage.foldername(name))[1] = auth.jwt()->>'tenant_id'
);

-- Política: Los usuarios solo pueden ver archivos de su tenant
CREATE POLICY "Users can view own tenant files"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'fotos'
  AND (storage.foldername(name))[1] = auth.jwt()->>'tenant_id'
);

-- Política: Los usuarios pueden actualizar archivos de su tenant
CREATE POLICY "Users can update own tenant files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'fotos'
  AND (storage.foldername(name))[1] = auth.jwt()->>'tenant_id'
);

-- Política: Los usuarios pueden eliminar archivos de su tenant
CREATE POLICY "Users can delete own tenant files"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'fotos'
  AND (storage.foldername(name))[1] = auth.jwt()->>'tenant_id'
);
```

## 3. Estructura de carpetas

El sistema organiza los archivos de la siguiente manera:

```
fotos/
├── {tenant_id}/
│   ├── firmas/
│   │   ├── firma_ingreso_{orden_id}_{timestamp}.png
│   │   ├── firma_retiro_{orden_id}_{timestamp}.png
│   │   └── firma_recepcionista_{orden_id}_{timestamp}.png
│   └── ordenes/
│       └── {orden_id}/
│           ├── foto_antes_{orden_id}_{timestamp}.jpg
│           ├── foto_durante_{orden_id}_{timestamp}.jpg
│           ├── foto_despues_{orden_id}_{timestamp}.jpg
│           ├── foto_detalle_{orden_id}_{timestamp}.jpg
│           ├── foto_suela_{orden_id}_{timestamp}.jpg
│           └── foto_laterales_{orden_id}_{timestamp}.jpg
```

## 4. Límites y consideraciones

- **Tamaño máximo por archivo:** 5MB (ajustable en configuración del bucket)
- **Formatos soportados:** PNG, JPEG, WebP, GIF
- **Retención:** Los archivos permanecen hasta que se eliminen manualmente
- **Acceso público:** Las URLs son públicas pero solo conocidas por usuarios autenticados
- **Multitenant:** Cada tenant solo puede acceder a sus propios archivos mediante RLS

## 5. Verificación

Para verificar que el bucket está correctamente configurado:

1. Inicia sesión en la aplicación
2. Crea una orden de prueba
3. Captura una firma digital
4. Si ves el mensaje "Firma guardada en la nube ☁️", la configuración es correcta
5. Verifica en **Storage > fotos** que se creó la estructura de carpetas

## 6. Troubleshooting

### Error: "bucket not found"
- Asegúrate de que el bucket se llama exactamente `fotos` (minúsculas)
- Verifica que el bucket existe en Storage

### Error: "permission denied" o "policy violation"
- Ejecuta las políticas SQL del paso 2
- Verifica que el usuario está autenticado
- Confirma que el `tenant_id` está presente en el JWT del usuario

### Error: "file too large"
- Ajusta el límite de tamaño en la configuración del bucket
- Comprime las imágenes antes de subirlas

### Las URLs no cargan las imágenes
- Verifica que el bucket está marcado como **público**
- Confirma que las políticas de SELECT están activas
- Prueba la URL directamente en el navegador
