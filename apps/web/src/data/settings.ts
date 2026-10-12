import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Tables, TablesUpdate } from '@/lib/database.types'
import { useSupabase } from '@/lib/supabase'
import { toAppError } from './errors'
import { queryKeys } from './query-keys'

export type Settings = Tables<'settings'>

export function useSettings() {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.settings,
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('*').eq('id', 1).single()
      if (error) throw toAppError(error)
      return data
    },
  })
}

export type SettingsValues = TablesUpdate<'settings'>

export function useSaveSettings() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (values: SettingsValues) => {
      const { data, error } = await supabase
        .from('settings')
        .update(values)
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}

/** Allowed logo types and the file extension each is stored with (functional analysis §3.8). */
export const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
}
export const LOGO_MAX_BYTES = 1024 * 1024

/** A signed URL for the private branding bucket, valid for an hour; refreshed well before it expires. */
export function useLogoUrl(path: string | null) {
  const supabase = useSupabase()
  return useQuery({
    queryKey: queryKeys.logoUrl(path ?? ''),
    enabled: path !== null,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from('branding')
        .createSignedUrl(path as string, 3600)
      if (error) throw toAppError(error)
      return data.signedUrl
    },
  })
}

export function useUploadLogo() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ file, previousPath }: { file: File; previousPath: string | null }) => {
      const path = `logo-${Date.now()}.${LOGO_TYPES[file.type]}`
      const upload = await supabase.storage
        .from('branding')
        .upload(path, file, { contentType: file.type })
      if (upload.error) throw toAppError(upload.error)
      const { data, error } = await supabase
        .from('settings')
        .update({ shop_logo_path: path })
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      // A leftover old file is harmless, so a failed removal is ignored.
      if (previousPath) await supabase.storage.from('branding').remove([previousPath])
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}

export function useRemoveLogo() {
  const supabase = useSupabase()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase
        .from('settings')
        .update({ shop_logo_path: null })
        .eq('id', 1)
        .select()
        .single()
      if (error) throw toAppError(error)
      await supabase.storage.from('branding').remove([path])
      return data
    },
    onSuccess: (data) => queryClient.setQueryData(queryKeys.settings, data),
  })
}
