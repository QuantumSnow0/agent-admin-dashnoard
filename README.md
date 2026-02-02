# Airtel Agents - Admin Dashboard

Admin dashboard for managing Airtel SmartConnect agents and customer registrations.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **UI**: shadcn/ui + Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Real-time)
- **State Management**: TanStack Query
- **Charts**: Recharts
- **Tables**: TanStack Table

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Up Environment Variables

Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

Update the following variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Your Supabase anon key
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key (for server-side operations)

### 3. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
admin-dashboard/
├── app/
│   ├── (auth)/
│   │   └── login/          # Login page
│   ├── dashboard/          # Dashboard routes
│   │   ├── agents/         # Agent management
│   │   ├── registrations/  # Registration management
│   │   └── analytics/      # Analytics & reports
│   ├── api/                # API routes
│   └── layout.tsx          # Root layout
├── components/
│   ├── ui/                 # shadcn/ui components
│   ├── agents/             # Agent-related components
│   └── registrations/      # Registration-related components
├── lib/
│   ├── supabase/           # Supabase client configs
│   ├── providers/          # React providers
│   └── utils/              # Utility functions
└── types/                  # TypeScript types
```

## Features

### ✅ Implemented

- [x] Next.js 16 App Router setup
- [x] TypeScript configuration
- [x] Tailwind CSS + shadcn/ui
- [x] Supabase SSR client setup
- [x] Authentication middleware
- [x] Login page
- [x] Basic dashboard layout
- [x] TanStack Query provider

### 🚧 To Implement

- [ ] Agent management (list, approve, reject, ban)
- [ ] Registration management (view, filter, update status)
- [ ] Analytics dashboard (charts, statistics)
- [ ] Real-time updates
- [ ] Export functionality (Excel/CSV)
- [ ] Search and filtering
- [ ] Bulk actions

## Authentication

The dashboard uses Supabase Auth with SSR. Users must be authenticated to access dashboard routes.

### Setting Up Admin Users

Admin users should be created in Supabase Auth dashboard or via the Supabase Admin API.

## Database Schema

The dashboard connects to the same Supabase database as the mobile app:

- `agents` - Agent profiles and status
- `customer_registrations` - Customer registrations
- `notifications` - System notifications
- `device_tokens` - Push notification tokens

## Development

### Adding shadcn/ui Components

```bash
npx shadcn@latest add [component-name]
```

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

## License

Private - Airtel Kenya
