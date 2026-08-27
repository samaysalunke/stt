/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: {
      id: string;
      email: string;
      displayName: string | null;
      avatarUrl: string | null;
    } | null;
    adminUser: {
      userId: string;
      email: string;
      displayName: string | null;
      role: 'owner' | 'ops' | 'trip_lead';
      tripIds: string[];
    } | null;
  }
}

interface ImportMetaEnv {
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_FROM?: string;
  readonly ADMIN_EMAIL?: string;
  readonly ZOHO_BOOKS_MODE?: 'disabled' | 'draft' | 'live';
  readonly ZOHO_DATA_CENTER?: 'com' | 'eu' | 'in' | 'com.au' | 'jp' | 'ca' | 'sa';
  readonly ZOHO_BOOKS_ORGANIZATION_ID?: string;
  readonly ZOHO_CLIENT_ID?: string;
  readonly ZOHO_CLIENT_SECRET?: string;
  readonly ZOHO_REFRESH_TOKEN?: string;
  readonly ZOHO_BOOKS_ITEM_ID?: string;
  readonly ZOHO_RETAINER_TEMPLATE_ID?: string;
  readonly ZOHO_INVOICE_TEMPLATE_ID?: string;
  readonly ZOHO_JOB_SECRET?: string;
  readonly ANALYTICS_LLM_PROVIDER?: 'anthropic' | 'openai' | 'test';
  readonly ANALYTICS_LLM_MODEL?: string;
  readonly ANALYTICS_LLM_API_KEY?: string;
  readonly ANALYTICS_LLM_FAKE_RESPONSE?: string;
}
