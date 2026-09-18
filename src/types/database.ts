// Hand-written for the POC. Regenerate once the schema is live with:
//   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
export type UserRole = "admin" | "customer";
export type OrderStatus = "pending" | "changes_requested" | "approved" | "rejected" | "fulfilled" | "cancelled";
export type AnnouncementType = "announcement" | "faq";

type UsersRow = { id: string; email: string; role: UserRole; company_name: string | null; invite_token: string | null; invited_at: string | null; activated_at: string | null; created_at: string };
type OrderMessagesRow = { id: string; order_id: string; author_id: string; author_role: UserRole; body: string; created_at: string };
type ProductsRow = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  category: string;
  unit_of_measure: string;
  price: number;
  image_url: string | null;
  stock_quantity: number;
  reorder_point: number;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};
type OrdersRow = {
  id: string;
  order_number: string;
  customer_id: string;
  status: OrderStatus;
  delivery_address: string | null;
  required_by: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};
type OrderItemsRow = { id: string; order_id: string; product_id: string; quantity: number; price_at_purchase: number };
type AnnouncementsRow = {
  id: string;
  title: string;
  content: string;
  type: AnnouncementType;
  priority: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export interface Database {
  public: {
    Tables: {
      users: { Row: UsersRow; Insert: Optional<UsersRow, "role" | "company_name" | "invite_token" | "invited_at" | "activated_at" | "created_at">; Update: Partial<UsersRow>; Relationships: [] };
      order_messages: { Row: OrderMessagesRow; Insert: Optional<OrderMessagesRow, "id" | "created_at">; Update: Partial<OrderMessagesRow>; Relationships: [] };
      products: {
        Row: ProductsRow;
        Insert: Optional<ProductsRow, "id" | "description" | "category" | "unit_of_measure" | "image_url" | "stock_quantity" | "reorder_point" | "is_archived" | "created_at" | "updated_at">;
        Update: Partial<ProductsRow>;
        Relationships: [];
      };
      orders: {
        Row: OrdersRow;
        Insert: Optional<OrdersRow, "id" | "order_number" | "status" | "delivery_address" | "required_by" | "note" | "created_at" | "updated_at">;
        Update: Partial<OrdersRow>;
        Relationships: [];
      };
      order_items: { Row: OrderItemsRow; Insert: Optional<OrderItemsRow, "id">; Update: Partial<OrderItemsRow>; Relationships: [] };
      announcements: {
        Row: AnnouncementsRow;
        Insert: Optional<AnnouncementsRow, "id" | "type" | "priority" | "expires_at" | "is_active" | "created_at">;
        Update: Partial<AnnouncementsRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: { is_admin: { Args: Record<string, never>; Returns: boolean } };
    Enums: { user_role: UserRole; order_status: OrderStatus; announcement_type: AnnouncementType };
    CompositeTypes: Record<string, never>;
  };
}

export type Product = ProductsRow;
export type Order = OrdersRow;
export type OrderItem = OrderItemsRow;
export type Announcement = AnnouncementsRow;
export type UserProfile = UsersRow;
export type OrderMessage = OrderMessagesRow;
