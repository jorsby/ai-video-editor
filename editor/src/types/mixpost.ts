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

export interface AccountGroupWithMembers {
  id: string;
  name: string;
  created_at: string;
  account_uuids: string[];
}

export interface AccountTagMap {
  [accountUuid: string]: string[];
}
