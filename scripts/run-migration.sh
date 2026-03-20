#!/bin/bash
# Run the prompt-driven generation migration via Supabase Dashboard SQL Editor
# Copy-paste the SQL from: supabase/migrations/20260320100000_prompt_driven_generation.sql
# Into: Supabase Dashboard → SQL Editor → New Query → Run

echo "=== Prompt-Driven Generation Migration ==="
echo ""
echo "Go to: https://supabase.com/dashboard/project/lmounotqnrspwuvcoemk/sql/new"
echo ""
echo "Paste the following SQL and click Run:"
echo ""
cat "$(dirname "$0")/../supabase/migrations/20260320100000_prompt_driven_generation.sql"
echo ""
echo "=== Or run: supabase db push --linked (requires supabase login first) ==="
