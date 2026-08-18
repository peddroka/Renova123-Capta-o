import { useEffect, useRef, useState } from "react";

export type QueryState<T> = {
  data: T | null;
  error: string;
  loading: boolean;
  reload: () => void;
};

class QueryClient {
  private cache = new Map<string, unknown>();

  async fetch<T>(key: string, loader: () => Promise<T>, fresh = false): Promise<T> {
    if (!fresh && this.cache.has(key)) return this.cache.get(key) as T;
    const data = await loader();
    this.cache.set(key, data);
    return data;
  }

  invalidate(key: string) { this.cache.delete(key); }
}

export const queryClient = new QueryClient();

export function useAppQuery<T>(key: string, loader: () => Promise<T>): QueryState<T> {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<Omit<QueryState<T>, "reload">>({ data: null, error: "", loading: true });

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, error: "", loading: true }));
    queryClient.fetch(key, () => loaderRef.current(), revision > 0)
      .then((data) => { if (active) setState({ data, error: "", loading: false }); })
      .catch((reason: unknown) => { if (active) setState({ data: null, error: reason instanceof Error ? reason.message : "Falha ao carregar os dados.", loading: false }); });
    return () => { active = false; };
  }, [key, revision]);

  return { ...state, reload: () => { queryClient.invalidate(key); setRevision((value) => value + 1); } };
}
