'use client';

import { Switch } from '@/components/ui/switch';
import type {
  TikTokAccountOptions,
  TikTokPrivacy,
} from '@/types/post';
import type { MixpostAccount } from '@/types/mixpost';

interface TikTokOptionsProps {
  accounts: MixpostAccount[];
  value: Record<string, TikTokAccountOptions>;
  onChange: (value: Record<string, TikTokAccountOptions>) => void;
}

const PRIVACY_OPTIONS: { value: TikTokPrivacy; label: string }[] = [
  { value: 'PUBLIC_TO_EVERYONE', label: 'Public' },
  { value: 'FOLLOWER_OF_CREATOR', label: 'Followers' },
  { value: 'MUTUAL_FOLLOW_FRIENDS', label: 'Friends' },
  { value: 'SELF_ONLY', label: 'Only Me' },
];

const DEFAULT_OPTIONS: TikTokAccountOptions = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  allow_comments: true,
  allow_duet: true,
  allow_stitch: true,
  is_aigc: false,
  content_disclosure: false,
  brand_organic_toggle: false,
  brand_content_toggle: false,
};

function getAccountKey(account: MixpostAccount): string {
  return `account-${account.id}`;
}

export function TikTokOptions({
  accounts,
  value,
  onChange,
}: TikTokOptionsProps) {
  const updateAccount = (
    key: string,
    updates: Partial<TikTokAccountOptions>
  ) => {
    const current = value[key] || { ...DEFAULT_OPTIONS };
    onChange({
      ...value,
      [key]: { ...current, ...updates },
    });
  };

  return (
    <div className="space-y-4">
      {accounts.map((account) => {
        const key = getAccountKey(account);
        const opts = value[key] || { ...DEFAULT_OPTIONS };

        return (
          <div
            key={account.id}
            className="space-y-3 rounded-lg border border-white/[0.08] bg-zinc-900/40 p-3"
          >
            {accounts.length > 1 && (
              <div className="flex items-center gap-2 mb-2">
                {account.image && (
                  <img
                    src={account.image}
                    alt=""
                    className="h-5 w-5 rounded-full"
                  />
                )}
                <span className="text-xs font-medium text-zinc-300">
                  {account.name}
                </span>
              </div>
            )}

            {/* Privacy level */}
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground">
                Privacy
              </label>
              <select
                value={opts.privacy_level}
                onChange={(e) =>
                  updateAccount(key, {
                    privacy_level: e.target.value as TikTokPrivacy,
                  })
                }
                className="h-8 w-full rounded-md border border-white/[0.08] bg-zinc-900/60 px-2 text-xs text-foreground outline-none focus:border-ring"
              >
                {PRIVACY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Toggle switches */}
            <div className="space-y-2">
              <ToggleRow
                label="Allow Comments"
                checked={opts.allow_comments}
                onChange={(v) => updateAccount(key, { allow_comments: v })}
              />
              <ToggleRow
                label="Allow Duet"
                checked={opts.allow_duet}
                onChange={(v) => updateAccount(key, { allow_duet: v })}
              />
              <ToggleRow
                label="Allow Stitch"
                checked={opts.allow_stitch}
                onChange={(v) => updateAccount(key, { allow_stitch: v })}
              />
              <ToggleRow
                label="AI-Generated Content"
                checked={opts.is_aigc}
                onChange={(v) => updateAccount(key, { is_aigc: v })}
              />
            </div>

            {/* Content Disclosure */}
            <div className="space-y-2 border-t border-white/[0.06] pt-2">
              <ToggleRow
                label="Content Disclosure"
                checked={opts.content_disclosure}
                onChange={(v) =>
                  updateAccount(key, {
                    content_disclosure: v,
                    // Reset sub-toggles when disabling
                    ...(v
                      ? {}
                      : {
                          brand_organic_toggle: false,
                          brand_content_toggle: false,
                        }),
                  })
                }
              />
              {opts.content_disclosure && (
                <div className="ml-4 space-y-2">
                  <ToggleRow
                    label="Brand Organic"
                    checked={opts.brand_organic_toggle}
                    onChange={(v) =>
                      updateAccount(key, { brand_organic_toggle: v })
                    }
                  />
                  <ToggleRow
                    label="Brand Content"
                    checked={opts.brand_content_toggle}
                    onChange={(v) =>
                      updateAccount(key, { brand_content_toggle: v })
                    }
                  />
                </div>
              )}
              <p className="text-[10px] text-muted-foreground/60">
                By posting, you agree to TikTok&apos;s Music Usage Confirmation.
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between cursor-pointer">
      <span className="text-xs text-zinc-300">{label}</span>
      <Switch size="sm" checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
