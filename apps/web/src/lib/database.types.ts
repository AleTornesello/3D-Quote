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
      consumables: {
        Row: {
          active: boolean
          created_at: string
          id: number
          name: string
          stock: number
          unit: string
          unit_price: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          created_at?: string
          id?: never
          name: string
          stock?: number
          unit?: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: never
          name?: string
          stock?: number
          unit?: string
          unit_price?: number
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
          created_at: string
          failure_rate: number
          hourly_rate: number
          id: number
          lifetime_hours: number | null
          model: string
          name: string
          power_w: number
          purchase_cost: number | null
          type: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          created_at?: string
          failure_rate?: number
          hourly_rate: number
          id?: never
          lifetime_hours?: number | null
          model: string
          name: string
          power_w: number
          purchase_cost?: number | null
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          failure_rate?: number
          hourly_rate?: number
          id?: never
          lifetime_hours?: number | null
          model?: string
          name?: string
          power_w?: number
          purchase_cost?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      quote_consumables: {
        Row: {
          consumable_id: number
          created_at: string
          id: number
          line_total: number | null
          quantity: number
          quote_id: number
          unit_price: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          consumable_id: number
          created_at?: string
          id?: never
          line_total?: never
          quantity: number
          quote_id: number
          unit_price: number
          updated_at?: string
        }
        Update: {
          consumable_id?: number
          created_at?: string
          id?: never
          line_total?: never
          quantity?: number
          quote_id?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_consumables_consumable_id_fkey'
            columns: ['consumable_id']
            isOneToOne: false
            referencedRelation: 'consumables'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_consumables_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_consumables_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes_list'
            referencedColumns: ['id']
          },
        ]
      }
      quote_plate_materials: {
        Row: {
          created_at: string
          grams: number
          id: number
          material_id: number
          plate_id: number
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          grams: number
          id?: never
          material_id: number
          plate_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          grams?: number
          id?: never
          material_id?: number
          plate_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_plate_materials_material_id_fkey'
            columns: ['material_id']
            isOneToOne: false
            referencedRelation: 'materials'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_plate_materials_plate_id_fkey'
            columns: ['plate_id']
            isOneToOne: false
            referencedRelation: 'quote_plates'
            referencedColumns: ['id']
          },
        ]
      }
      quote_plates: {
        Row: {
          computed_total: number | null
          created_at: string
          description: string
          energy_cost: number | null
          failure_cost: number | null
          id: number
          machine_cost: number | null
          markup_amount: number | null
          markup_pct: number | null
          material_cost: number | null
          override_reason: string | null
          override_total: number | null
          plate_total: number | null
          priced_at: string | null
          print_time_s: number | null
          printer_id: number | null
          quantity: number
          quote_id: number
          setup_fee: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          computed_total?: number | null
          created_at?: string
          description: string
          energy_cost?: number | null
          failure_cost?: number | null
          id?: never
          machine_cost?: number | null
          markup_amount?: number | null
          markup_pct?: number | null
          material_cost?: number | null
          override_reason?: string | null
          override_total?: number | null
          plate_total?: never
          priced_at?: string | null
          print_time_s?: number | null
          printer_id?: number | null
          quantity?: number
          quote_id: number
          setup_fee?: number | null
          updated_at?: string
        }
        Update: {
          computed_total?: number | null
          created_at?: string
          description?: string
          energy_cost?: number | null
          failure_cost?: number | null
          id?: never
          machine_cost?: number | null
          markup_amount?: number | null
          markup_pct?: number | null
          material_cost?: number | null
          override_reason?: string | null
          override_total?: number | null
          plate_total?: never
          priced_at?: string | null
          print_time_s?: number | null
          printer_id?: number | null
          quantity?: number
          quote_id?: number
          setup_fee?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'quote_plates_printer_id_fkey'
            columns: ['printer_id']
            isOneToOne: false
            referencedRelation: 'printers'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_plates_quote_id_fkey'
            columns: ['quote_id']
            isOneToOne: false
            referencedRelation: 'quotes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'quote_plates_quote_id_fkey'
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
          number: string | null
          number_seq: number | null
          number_year: number | null
          plate_count: number | null
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
      add_quote_consumable: {
        Args: { consumable_id: number; quantity: number; quote_id: number }
        Returns: number
      }
      clear_price_override: { Args: { plate_id: number }; Returns: undefined }
      create_quote_plate: {
        Args: { description: string; printer_id?: number; quote_id: number }
        Returns: number
      }
      get_quote_send_blockers: {
        Args: { quote_id: number }
        Returns: {
          code: string
          quote_plate_id: number
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
          last_sign_in_at: string
          role: string
          user_id: string
        }[]
      }
      mark_quote_accepted: { Args: { quote_id: number }; Returns: undefined }
      mark_quote_rejected: { Args: { quote_id: number }; Returns: undefined }
      mark_quote_sent: { Args: { quote_id: number }; Returns: undefined }
      save_plate_material: {
        Args: { grams: number; material_id: number; plate_id: number }
        Returns: number
      }
      service_copy_quote_plates: { Args: { new_id: number; source_id: number }; Returns: undefined }
      service_create_quote_copy: {
        Args: { created_by: string; source_id: number }
        Returns: number
      }
      set_markup_override: { Args: { pct: number; quote_id: number }; Returns: undefined }
      set_plate_printer: { Args: { plate_id: number; printer_id: number }; Returns: undefined }
      set_price_override: {
        Args: { plate_id: number; reason: string; total: number }
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
