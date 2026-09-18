// Hand-written for the POC. Regenerate once the schema is live with:
//   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
export type UserRole = "admin" | "customer";
export type OrderStatus = "pending" | "approved" | "rejected" | "fulfilled";
export type AnnouncementType = "announcement" | "faq";

export interface Database {
  public: {
    Tables: {
      users: {
        Row: { id: string; email: string; role: UserRole; company_name: string | null; created_at: string };
        Insert: { id: string; email: string; role?: UserRole; company_name?: string | null; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["users"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          price: number;
          image_url: string | null;
          stock_quantity: number;
          is_archived: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          price: number;
          image_url?: string | null;
          stock_quantity?: number;
          is_archived?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      orders: {
        Row: { id: string; customer_id: string; status: OrderStatus; created_at: string; updated_at: string };
        Insert: { id?: string; customer_id: string; status?: OrderStatus; created_at?: string; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["orders"]["Insert"]>;
        Relationships: [];
      };
      order_items: {
        Row: { id: string; order_id: string; product_id: string; quantity: number; price_at_purchase: number };
        Insert: { id?: string; order_id: string; product_id: string; quantity: number; price_at_purchase: number };
        Update: Partial<Database["public"]["Tables"]["order_items"]["Insert"]>;
        Relationships: [];
      };
      announcements: {
        Row: { id: string; title: string; content: string; type: AnnouncementType; is_active: boolean; created_at: string };
        Insert: { id?: string; title: string; content: string; type?: AnnouncementType; is_active?: boolean; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["announcements"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: { is_admin: { Args: Record<string, never>; Returns: boolean } };
    Enums: { user_role: UserRole; order_status: OrderStatus; announcement_type: AnnouncementType };
    CompositeTypes: Record<string, never>;
  };
}

export type Product = Database["public"]["Tables"]["products"]["Row"];
export type Order = Database["public"]["Tables"]["orders"]["Row"];
export type OrderItem = Database["public"]["Tables"]["order_items"]["Row"];
export type Announcement = Database["public"]["Tables"]["announcements"]["Row"];
export type UserProfile = Database["public"]["Tables"]["users"]["Row"];
