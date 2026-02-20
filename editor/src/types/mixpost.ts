export interface MixpostAccount {
  id: number;
  uuid: string;
  name: string;
  username: string;
  image: string | null;
  provider: string;
  authorized: boolean;
  created_at: string;
}
