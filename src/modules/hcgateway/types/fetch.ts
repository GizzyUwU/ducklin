export type FetchRequest = {
    queries: Record<string, any> | null;
}

export type FetchResponseItem = {
  _id: string;
  data: Record<string, any>;
  id: string;
  start: string;
  end: string;
  app: string;
};

export type FetchResponse = FetchResponseItem[];