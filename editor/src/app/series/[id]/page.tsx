import { notFound } from 'next/navigation';

interface SeriesDetailRouteProps {
  params: Promise<{ id: string }>;
}

export default async function SeriesDetailRoute({
  params,
}: SeriesDetailRouteProps) {
  await params;
  notFound();
}
