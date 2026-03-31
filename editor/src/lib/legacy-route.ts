import { NextResponse } from 'next/server';

type LegacyRouteRetiredConfig = {
  route: string;
  replacements?: string[];
  message: string;
  details?: string[];
  status?: number;
};

export function legacyRouteRetired(config: LegacyRouteRetiredConfig) {
  const {
    route,
    replacements = [],
    message,
    details = [],
    status = 410,
  } = config;

  return NextResponse.json(
    {
      success: false,
      code: 'LEGACY_ROUTE_RETIRED',
      route,
      message,
      replacements,
      details,
    },
    {
      status,
      headers: {
        'X-Octupost-Legacy-Route': 'retired',
        ...(replacements.length > 0
          ? { 'X-Octupost-Replacements': replacements.join(', ') }
          : {}),
      },
    }
  );
}
