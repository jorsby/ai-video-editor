'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  API_OPS_ROUTES,
  getApiRouteDefinition,
  type ApiRouteCategory,
  type ApiRouteDefinition,
} from '@/lib/api-ops/route-registry';

type TryResult = {
  status: number;
  durationMs: number;
  url: string;
  body: unknown;
};

const CATEGORY_GROUPS: Array<{ key: ApiRouteCategory; label: string }> = [
  { key: 'project', label: 'Project' },
  { key: 'series', label: 'Series' },
  { key: 'episode', label: 'Episode' },
  { key: 'asset', label: 'Asset' },
  { key: 'variant', label: 'Variant' },
  { key: 'scene', label: 'Scene' },
  { key: 'webhook', label: 'Webhook' },
];

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

function parseJsonInput<T>(label: string, value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`${label} JSON is invalid`);
  }
}

function buildPath(
  route: ApiRouteDefinition,
  pathParams: Record<string, string>
): string {
  return route.pathTemplate.replace(/\{([^}]+)\}/g, (_, key: string) => {
    return encodeURIComponent(pathParams[key] ?? '');
  });
}

function getMethodVariant(method: ApiRouteDefinition['method']) {
  if (method === 'GET') return 'secondary' as const;
  if (method === 'DELETE') return 'destructive' as const;
  return 'default' as const;
}

export function ApiOpsDashboard() {
  const [selectedRouteId, setSelectedRouteId] = useState(
    API_OPS_ROUTES[0]?.id ?? ''
  );
  const [filterText, setFilterText] = useState('');

  const [pathParamsText, setPathParamsText] = useState('{}');
  const [queryParamsText, setQueryParamsText] = useState('{}');
  const [bodyText, setBodyText] = useState('{}');

  const [testing, setTesting] = useState(false);
  const [tryError, setTryError] = useState<string | null>(null);
  const [tryResult, setTryResult] = useState<TryResult | null>(null);

  const selectedRoute = useMemo(
    () => getApiRouteDefinition(selectedRouteId) ?? API_OPS_ROUTES[0],
    [selectedRouteId]
  );

  useEffect(() => {
    if (!selectedRoute) return;

    setPathParamsText(prettyJson(selectedRoute.pathParams ?? {}));
    setQueryParamsText(prettyJson(selectedRoute.queryParams ?? {}));
    setBodyText(prettyJson(selectedRoute.body ?? null));
    setTryError(null);
    setTryResult(null);
  }, [selectedRoute]);

  const filteredRoutes = useMemo(() => {
    const needle = filterText.trim().toLowerCase();
    if (!needle) return API_OPS_ROUTES;

    return API_OPS_ROUTES.filter((route) => {
      const haystack = [
        route.label,
        route.pathTemplate,
        route.method,
        route.description,
        route.category,
      ]
        .join(' ')
        .toLowerCase();

      return haystack.includes(needle);
    });
  }, [filterText]);

  const groupedRoutes = useMemo(
    () =>
      CATEGORY_GROUPS.map((group) => ({
        ...group,
        routes: filteredRoutes.filter((route) => route.category === group.key),
      })),
    [filteredRoutes]
  );

  const runTryIt = useCallback(async () => {
    if (!selectedRoute) return;

    setTesting(true);
    setTryError(null);
    setTryResult(null);

    try {
      const pathParams = parseJsonInput<Record<string, string>>(
        'Path params',
        pathParamsText
      );
      const queryParams = parseJsonInput<Record<string, string>>(
        'Query params',
        queryParamsText
      );

      const path = buildPath(selectedRoute, pathParams);
      const url = new URL(path, window.location.origin);

      Object.entries(queryParams).forEach(([key, value]) => {
        if (`${value}`.length > 0) {
          url.searchParams.set(key, String(value));
        }
      });

      const requestInit: RequestInit = {
        method: selectedRoute.method,
        headers: {},
      };

      if (selectedRoute.method !== 'GET') {
        const bodyValue = parseJsonInput<unknown>('Request body', bodyText);
        requestInit.headers = {
          'Content-Type': 'application/json',
        };
        if (bodyValue !== null) {
          requestInit.body = JSON.stringify(bodyValue);
        }
      }

      const startedAt = performance.now();
      const response = await fetch(url.toString(), requestInit);
      const durationMs = Math.round(performance.now() - startedAt);
      const contentType = response.headers.get('content-type') ?? '';

      const responseBody = contentType.includes('application/json')
        ? await response.json()
        : await response.text();

      setTryResult({
        status: response.status,
        durationMs,
        url: url.toString(),
        body: responseBody,
      });
    } catch (error) {
      setTryError(error instanceof Error ? error.message : 'Request failed');
    } finally {
      setTesting(false);
    }
  }, [bodyText, pathParamsText, queryParamsText, selectedRoute]);

  if (!selectedRoute) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>API Reference</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No API routes are registered.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">API Reference</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Internal endpoint reference with example payloads and a direct Try It
          panel.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-hidden flex flex-col">
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>Browse by category.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 overflow-hidden flex-1 min-h-0">
            <Input
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="Filter endpoints"
              className="flex-shrink-0"
            />

            <div className="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
              {groupedRoutes.map((group) =>
                group.routes.length > 0 ? (
                  <div key={group.key} className="space-y-2">
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </div>
                    <div className="space-y-2">
                      {group.routes.map((route) => {
                        const selected = route.id === selectedRoute.id;

                        return (
                          <button
                            key={route.id}
                            type="button"
                            onClick={() => setSelectedRouteId(route.id)}
                            className={`w-full rounded-lg border p-3 text-left transition-colors ${
                              selected
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/40'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant={getMethodVariant(route.method)}>
                                {route.method}
                              </Badge>
                              <span className="text-sm font-medium">
                                {route.label}
                              </span>
                            </div>
                            <div className="mt-2 font-mono text-[11px] text-muted-foreground break-all">
                              {route.pathTemplate}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={getMethodVariant(selectedRoute.method)}>
                  {selectedRoute.method}
                </Badge>
                <Badge variant="outline">{selectedRoute.category}</Badge>
                <Badge variant="outline">{selectedRoute.auth}</Badge>
              </div>
              <CardTitle className="mt-2">{selectedRoute.label}</CardTitle>
              <CardDescription>{selectedRoute.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Path
                </div>
                <div className="mt-2 rounded-md border bg-muted/20 p-3 font-mono text-xs break-all">
                  {selectedRoute.pathTemplate}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Path Params
                </div>
                {Object.entries(selectedRoute.pathParams ?? {}).length > 0 ? (
                  <div className="mt-2 space-y-2">
                    {Object.entries(selectedRoute.pathParams ?? {}).map(
                      ([name, example]) => (
                        <div
                          key={name}
                          className="rounded-md border bg-muted/20 px-3 py-2"
                        >
                          <div className="font-mono text-xs">{name}</div>
                          <div className="text-xs text-muted-foreground">
                            Example:{' '}
                            <span className="font-mono">{example}</span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <div className="mt-2 text-sm text-muted-foreground">
                    No path parameters.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="examples" className="space-y-4">
            <TabsList>
              <TabsTrigger value="examples">Examples</TabsTrigger>
              <TabsTrigger value="try">Try It</TabsTrigger>
            </TabsList>

            <TabsContent value="examples" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Example Request Body</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    readOnly
                    rows={12}
                    className="font-mono text-xs"
                    value={prettyJson(selectedRoute.body ?? null)}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Example Response</CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    readOnly
                    rows={12}
                    className="font-mono text-xs"
                    value={prettyJson(selectedRoute.response ?? null)}
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="try" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Request</CardTitle>
                  <CardDescription>
                    Edit params/payload, then call the selected endpoint.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">
                        Path params JSON
                      </div>
                      <Textarea
                        rows={8}
                        className="font-mono text-xs"
                        value={pathParamsText}
                        onChange={(event) =>
                          setPathParamsText(event.target.value)
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">
                        Query params JSON
                      </div>
                      <Textarea
                        rows={8}
                        className="font-mono text-xs"
                        value={queryParamsText}
                        onChange={(event) =>
                          setQueryParamsText(event.target.value)
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-sm text-muted-foreground">
                      Request body JSON
                    </div>
                    <Textarea
                      rows={12}
                      className="font-mono text-xs"
                      value={bodyText}
                      onChange={(event) => setBodyText(event.target.value)}
                      disabled={selectedRoute.method === 'GET'}
                    />
                  </div>

                  {tryError ? (
                    <div className="text-sm text-red-500">{tryError}</div>
                  ) : null}

                  <Button onClick={runTryIt} disabled={testing}>
                    {testing ? 'Sending...' : 'Try It'}
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Response</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tryResult ? (
                    <>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge
                          variant={
                            tryResult.status >= 400 ? 'destructive' : 'default'
                          }
                        >
                          {tryResult.status}
                        </Badge>
                        <Badge variant="outline">
                          {tryResult.durationMs}ms
                        </Badge>
                      </div>
                      <div className="rounded-md border bg-muted/20 p-3 font-mono text-xs break-all">
                        {tryResult.url}
                      </div>
                      <Textarea
                        readOnly
                        rows={14}
                        className="font-mono text-xs"
                        value={prettyJson(tryResult.body)}
                      />
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      No request executed yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
