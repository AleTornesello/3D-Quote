export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      clients: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: number
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: never
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: never
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      materials: {
        Row: {
          active: boolean
          color: string | null
          cost_per_kg: number
          created_at: string
          density_g_cm3: number
          id: number
          name: string
          type: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          color?: string | null
          cost_per_kg: number
          created_at?: string
          density_g_cm3: number
          id?: never
          name: string
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          color?: string | null
          cost_per_kg?: number
          created_at?: string
          density_g_cm3?: number
          id?: never
          name?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      printers: {
        Row: {
          active: boolean
          build_x_mm: number
          build_y_mm: number
          build_z_mm: number
          created_at: string
          hourly_rate: number
          id: number
          model: string
          name: string
          nozzle_diameter_mm: number
          power_w: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          build_x_mm: number
          build_y_mm: number
          build_z_mm: number
          created_at?: string
          hourly_rate: number
          id?: never
          model: string
          name: string
          nozzle_diameter_mm?: number
          power_w: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          build_x_mm?: number
          build_y_mm?: number
          build_z_mm?: number
          created_at?: string
          hourly_rate?: number
          id?: never
          model?: string
          name?: string
          nozzle_diameter_mm?: number
          power_w?: number
          updated_at?: string
        }
        Relationships: []
      }
      quote_items: {
        Row: {
          bbox_x_mm: number | null
          bbox_y_mm: number | null
          bbox_z_mm: number | null
          computed_total: number | null
          created_at: string
          description: string
          energy_cost: number | null
          failure_cost: number | null
          filament_g: number | null
          id: number
          infill_percent: number
          item_total: number | null
          layer_height_mm: number
          machine_cost: number | null
          markup_amount: number | null
          markup_pct: number | null
          material_cost: number | null
          material_id: number | null
          model_path: string
          original_filename: string
          override_reason: string | null
          override_total: number | null
          priced_at: string | null
          print_time_s: number | null
          printer_id: number | null
          quantity: number
          quote_id: number
          setup_fee: number | null
          supports: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bbox_x_mm?: number | null
          bbox_y_mm?: number | null
          bbox_z_mm?: number | null
          computed_total?: number | null
          created_at?: string
          description: string
          energy_cost?: number | null
          failure_cost?: number | null
          filament_g?: number | null
          id?: never
          infill_percent?: number
          item_total?: never
          layer_height_mm?: number
          machine_cost?: number | null
          markup_amount?: number | null
          markup_pct?: number | null
          material_cost?: number | null
          material_id?: number | null
          model_path: string
          original_filename: string
          override_reason?: string | null
          override_total?: number | null
          priced_at?: string | null
          print_time_s?: number | null
          printer_id?: number | null
          quantity?: number
          quote_id: number
          setup_fee?: number | null
          supports?: boolean
          updated_at?: string
        }
        Update: {
          bbox_x_mm?: number | null
          bbox_y_mm?: number | null
          bbox_z_mm?: number | null
          computed_total?: number | null
          created_at?: string
          description?: string
          energy_cost?: number | null
          failure_cost?: number | null
          filament_g?: number | null
          id?: never
          infill_percent?: number
          item_total?: never
          layer_height_mm?: number
          machine_cost?: number | null
          markup_amount?: number | null
          markup_pct?: number | null
          material_cost?: number | null
          material_id?: number | null
          model_path?: string
          original_filename?: string
          override_reason?: string | null
          override_total?: number | null
          priced_at?: string | null
          print_time_s?: number | null
          printer_id?: number | null
          quantity?: number
          quote_id?: number
          setup_fee?: number | null
          supports?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_items_material_id_fkey'
            columns: ['material_id']
            isOneToOne: false
            referencedRelation: 'materials'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_items_printer_id_fkey'
            columns: ['printer_id']
            isOneToOne: false
            referencedRelation: 'printers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_items_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_items_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes_list'
            referencedColumns: ['id']
          },
        ]
      }
      quotes: {
        Row: {
          client_id: number
          created_at: string
          created_by: string
          id: number
          markup_override_pct: number | null
          notes: string | null
          number: string
          number_seq: number
          number_year: number
          sent_at: string | null
          status: string
          updated_at: string
          valid_until: string
          vat_rate_pct: number | null
        }
        ComputedFields: never
        Insert: {
          client_id: number
          created_at?: string
          created_by?: string
          id?: never
          markup_override_pct?: number | null
          notes?: string | null
          number: string
          number_seq: number
          number_year: number
          sent_at?: string | null
          status?: string
          updated_at?: string
          valid_until: string
          vat_rate_pct?: number | null
        }
        Update: {
          client_id?: number
          created_at?: string
          created_by?: string
          id?: never
          markup_override_pct?: number | null
          notes?: string | null
          number?: string
          number_seq?: number
          number_year?: number
          sent_at?: string | null
          status?: string
          updated_at?: string
          valid_until?: string
          vat_rate_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: 'quotes_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'staff'
            referencedColumns: ['user_id']
          },
        ]
      }
      settings: {
        Row: {
          created_at: string
          currency: string
          default_markup_pct: number
          default_validity_days: number
          energy_price_kwh: number
          failure_allowance_pct: number
          id: number
          minimum_item_price: number
          pdf_terms_en: string | null
          pdf_terms_it: string | null
          quote_prefix: string
          setup_fee: number
          shop_address: string | null
          shop_email: string | null
          shop_logo_path: string | null
          shop_name: string | null
          shop_phone: string | null
          shop_vat_number: string | null
          updated_at: string
          vat_rate_pct: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          currency?: string
          default_markup_pct?: number
          default_validity_days?: number
          energy_price_kwh?: number
          failure_allowance_pct?: number
          id?: number
          minimum_item_price?: number
          pdf_terms_en?: string | null
          pdf_terms_it?: string | null
          quote_prefix?: string
          setup_fee?: number
          shop_address?: string | null
          shop_email?: string | null
          shop_logo_path?: string | null
          shop_name?: string | null
          shop_phone?: string | null
          shop_vat_number?: string | null
          updated_at?: string
          vat_rate_pct?: number
        }
        Update: {
          created_at?: string
          currency?: string
          default_markup_pct?: number
          default_validity_days?: number
          energy_price_kwh?: number
          failure_allowance_pct?: number
          id?: number
          minimum_item_price?: number
          pdf_terms_en?: string | null
          pdf_terms_it?: string | null
          quote_prefix?: string
          setup_fee?: number
          shop_address?: string | null
          shop_email?: string | null
          shop_logo_path?: string | null
          shop_name?: string | null
          shop_phone?: string | null
          shop_vat_number?: string | null
          updated_at?: string
          vat_rate_pct?: number
        }
        Relationships: []
      }
      slicing_jobs: {
        Row: {
          attempts: number
          bbox_x_mm: number | null
          bbox_y_mm: number | null
          bbox_z_mm: number | null
          error: string | null
          filament_g: number | null
          filament_mm: number | null
          finished_at: string | null
          id: number
          layer_count: number | null
          print_time_s: number | null
          queued_at: string
          quote_item_id: number
          slicer_version: string | null
          started_at: string | null
          status: string
        }
        ComputedFields: never
        Insert: {
          attempts?: number
          bbox_x_mm?: number | null
          bbox_y_mm?: number | null
          bbox_z_mm?: number | null
          error?: string | null
          filament_g?: number | null
          filament_mm?: number | null
          finished_at?: string | null
          id?: never
          layer_count?: number | null
          print_time_s?: number | null
          queued_at?: string
          quote_item_id: number
          slicer_version?: string | null
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          bbox_x_mm?: number | null
          bbox_y_mm?: number | null
          bbox_z_mm?: number | null
          error?: string | null
          filament_g?: number | null
          filament_mm?: number | null
          finished_at?: string | null
          id?: never
          layer_count?: number | null
          print_time_s?: number | null
          queued_at?: string
          quote_item_id?: number
          slicer_version?: string | null
          started_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'slicing_jobs_quote_item_id_fkey'
            columns: ['quote_item_id']
            isOneToOne: false
            referencedRelation: 'quote_items'
            referencedColumns: ['id']
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          language: string
          role: string
          updated_at: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          language?: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          language?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      quotes_list: {
        Row: {
          client_company: string | null
          client_id: number | null
          client_name: string | null
          created_at: string | null
          created_by: string | null
          created_by_name: string | null
          created_on: string | null
          id: number | null
          item_count: number | null
          number: string | null
          number_seq: number | null
          number_year: number | null
          sent_at: string | null
          status: string | null
          total: number | null
          valid_until: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: 'quotes_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quotes_created_by_fkey'
            columns: ['created_by']
            isOneToOne: false
            referencedRelation: 'staff'
            referencedColumns: ['user_id']
          },
        ]
      }
    }
    Functions: {
      clear_price_override: { Args: { item_id: number }; Returns: undefined }
      create_quote_item: {
        Args: {
          description: string
          infill_percent?: number
          layer_height_mm?: number
          material_id?: number
          model_path: string
          original_filename: string
          printer_id?: number
          quantity?: number
          quote_id: number
          supports?: boolean
        }
        Returns: number
      }
      get_quote_send_blockers: {
        Args: { quote_id: number }
        Returns: {
          code: string
          quote_item_id: number
        }[]
      }
      list_staff: {
        Args: Record<PropertyKey, never>
        Returns: {
          active: boolean
          created_at: string
          display_name: string
          email: string
          language: string
          role: string
          user_id: string
        }[]
      }
      mark_quote_accepted: { Args: { quote_id: number }; Returns: undefined }
      mark_quote_rejected: { Args: { quote_id: number }; Returns: undefined }
      mark_quote_sent: { Args: { quote_id: number }; Returns: undefined }
      retry_slicing: { Args: { item_id: number }; Returns: number }
      service_copy_quote_items: {
        Args: { files: Json; new_id: number; source_id: number }
        Returns: undefined
      }
      service_create_quote_copy: {
        Args: { created_by: string; source_id: number }
        Returns: number
      }
      set_markup_override: { Args: { pct: number; quote_id: number }; Returns: undefined }
      set_price_override: {
        Args: { item_id: number; reason: string; total: number }
        Returns: undefined
      }
      update_quote_item_settings: {
        Args: {
          infill_percent: number
          item_id: number
          layer_height_mm: number
          material_id: number
          printer_id: number
          supports: boolean
        }
        Returns: undefined
      }
      worker_claim_job: {
        Args: { max_attempts: number; visibility_timeout_s: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      worker_complete_job: {
        Args: { job_id: number; msg_id: number; results: Json }
        Returns: undefined
      }
      worker_fail_job: {
        Args: { error: string; final: boolean; job_id: number; msg_id: number }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
