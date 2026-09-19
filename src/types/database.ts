// Hand-written for the POC. Regenerate once the schema is live with:
//   npx supabase gen types typescript --project-id <ref> > src/types/database.ts
export type UserRole = "admin" | "finance" | "customer";
export type OrderStatus = "pending" | "changes_requested" | "approved" | "rejected" | "fulfilled" | "cancelled";
export type AnnouncementType = "announcement" | "faq";

type UsersRow = { id: string; email: string; role: UserRole; company_name: string | null; billing_address: string | null; ntn: string | null; strn: string | null; invite_token: string | null; invited_at: string | null; activated_at: string | null; created_at: string };
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

type AccountsRow = { id: string; code: string; name: string; type: AccountTypeDb; parent_id: string | null; system_key: string | null; is_group: boolean; is_active: boolean; created_at: string };
type JournalEntriesRow = { id: string; entry_no: string; entry_date: string; narration: string; source_type: string | null; source_id: string | null; reversal_of: string | null; posted_by: string | null; posted_at: string };
type JournalLinesRow = { id: string; entry_id: string; account_id: string; debit: number; credit: number; party_id: string | null; memo: string | null; sort_order: number };
type InvoicesRow = {
  id: string; invoice_number: string | null; type: InvoiceTypeDb; status: InvoiceStatusDb;
  order_id: string | null; customer_id: string;
  seller: Record<string, unknown>; buyer: Record<string, unknown>; currency: string;
  tax_rate: number; subtotal: number; discount: number; freight: number; tax_amount: number; total: number;
  issue_date: string | null; due_date: string | null; terms_days: number; notes: string | null;
  pdf_path: string | null; pdf_sha256: string | null; journal_entry_id: string | null; credit_note_for: string | null;
  issued_by: string | null; issued_at: string | null; voided_at: string | null; void_reason: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
type InvoiceItemsRow = { id: string; invoice_id: string; order_item_id: string | null; sku: string; name: string; unit_of_measure: string; quantity: number; unit_price: number; line_total: number; sort_order: number };
type InvoicePaymentsRow = { id: string; invoice_id: string; amount: number; paid_on: string; method: PaymentMethodDb; reference: string | null; note: string | null; journal_entry_id: string | null; recorded_by: string | null; created_at: string };
type CompanySettingsRow = {
  id: boolean; legal_name: string; address: string; city: string; country: string;
  phone: string | null; email: string | null; ntn: string | null; strn: string | null; bank_details: string | null;
  default_tax_rate: number; default_terms_days: number; invoice_prefix: string; credit_note_prefix: string;
  fiscal_year_start_month: number; updated_at: string;
};
type PeriodsRow = { id: string; name: string; starts_on: string; ends_on: string; closed_at: string | null; closed_by: string | null; created_at: string };

type AccountTypeDb = "asset" | "liability" | "equity" | "income" | "expense";
type InvoiceTypeDb = "proforma" | "tax_invoice" | "credit_note";
type InvoiceStatusDb = "draft" | "issued" | "void";
type PaymentMethodDb = "bank_transfer" | "cheque" | "cash" | "online" | "adjustment";

type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export interface Database {
  public: {
    Tables: {
      users: { Row: UsersRow; Insert: Optional<UsersRow, "role" | "company_name" | "billing_address" | "ntn" | "strn" | "invite_token" | "invited_at" | "activated_at" | "created_at">; Update: Partial<UsersRow>; Relationships: [] };
      accounts:           { Row: AccountsRow;        Insert: Optional<AccountsRow, "id" | "parent_id" | "system_key" | "is_group" | "is_active" | "created_at">; Update: Partial<AccountsRow>; Relationships: [] };
      journal_entries:    { Row: JournalEntriesRow;  Insert: Optional<JournalEntriesRow, "id" | "source_type" | "source_id" | "reversal_of" | "posted_by" | "posted_at">; Update: Partial<JournalEntriesRow>; Relationships: [] };
      journal_lines:      { Row: JournalLinesRow;    Insert: Optional<JournalLinesRow, "id" | "debit" | "credit" | "party_id" | "memo" | "sort_order">; Update: Partial<JournalLinesRow>; Relationships: [] };
      invoices:           { Row: InvoicesRow;        Insert: Optional<InvoicesRow, "id" | "invoice_number" | "type" | "status" | "order_id" | "seller" | "buyer" | "currency" | "subtotal" | "discount" | "freight" | "tax_amount" | "total" | "issue_date" | "due_date" | "terms_days" | "notes" | "pdf_path" | "pdf_sha256" | "journal_entry_id" | "credit_note_for" | "issued_by" | "issued_at" | "voided_at" | "void_reason" | "created_by" | "created_at" | "updated_at">; Update: Partial<InvoicesRow>; Relationships: [] };
      invoice_items:      { Row: InvoiceItemsRow;    Insert: Optional<InvoiceItemsRow, "id" | "order_item_id" | "unit_of_measure" | "sort_order">; Update: Partial<InvoiceItemsRow>; Relationships: [] };
      invoice_payments:   { Row: InvoicePaymentsRow; Insert: Optional<InvoicePaymentsRow, "id" | "paid_on" | "method" | "reference" | "note" | "journal_entry_id" | "recorded_by" | "created_at">; Update: Partial<InvoicePaymentsRow>; Relationships: [] };
      company_settings:   { Row: CompanySettingsRow; Insert: Partial<CompanySettingsRow>; Update: Partial<CompanySettingsRow>; Relationships: [] };
      accounting_periods: { Row: PeriodsRow;         Insert: Optional<PeriodsRow, "id" | "closed_at" | "closed_by" | "created_at">; Update: Partial<PeriodsRow>; Relationships: [] };
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
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      next_document_number: { Args: { p_scope: string }; Returns: number };
      post_journal_entry: {
        Args: { p_entry_no: string; p_entry_date: string; p_narration: string; p_source_type: string | null; p_source_id: string | null; p_lines: unknown };
        Returns: string;
      };
    };
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
export type AccountRow = AccountsRow;
export type JournalEntryRow = JournalEntriesRow;
export type JournalLineRow = JournalLinesRow;
export type Invoice = InvoicesRow;
export type InvoiceItem = InvoiceItemsRow;
export type InvoicePayment = InvoicePaymentsRow;
export type CompanySettings = CompanySettingsRow;
export type AccountingPeriod = PeriodsRow;
