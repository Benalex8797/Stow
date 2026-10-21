"use client";

import React, { useState, useEffect } from "react";
import { apiFetch, ApiError } from "@/lib/api";
import ErrorRetry from "@/components/ui/ErrorRetry";
import AppearanceSettings from "@/components/settings/AppearanceSettings";
import BiometricAccessSettings from "@/components/settings/BiometricAccessSettings";
import OAuthAccountsSettings from "@/components/settings/OAuthAccountsSettings";
import ApiKeysSettings from "@/components/settings/ApiKeysSettings";
import { useSession } from "@/context/SessionProvider";
import { Settings, Bell, BellOff, Clock, Loader2 } from "lucide-react";

interface NotificationCategory {
  id: string;
  label: string;
  description: string;
}

interface NotificationPreferences {
  savingsReminders: boolean;
  goalProgress: boolean;
  withdrawalAlerts: boolean;
  systemUpdates: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

const notificationCategories: NotificationCategory[] = [
  {
    id: "savingsReminders",
    label: "Savings Reminders",
    description: "Get reminders about your savings goals and milestones",
  },
  {
    id: "goalProgress",
    label: "Goal Progress",
    description: "Notifications when you make progress toward your goals",
  },
  {
    id: "withdrawalAlerts",
    label: "Withdrawal Alerts",
    description: "Important alerts about withdrawal requests and completions",
  },
  {
    id: "systemUpdates",
    label: "System Updates",
    description: "Platform updates, maintenance, and new features",
  },
];

export default function SettingsPage() {
  const { t } = useTranslation();
  const { user } = useSession();
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    savingsReminders: true,
    goalProgress: true,
    withdrawalAlerts: true,
    systemUpdates: false,
    quietHoursEnabled: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "08:00",
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await apiFetch("/api/user/preferences/notifications");

      if (!response.ok) {
        throw new ApiError("Failed to load preferences", response.status);
      }

      const data = await response.json();
      setPreferences(data);
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error("Failed to load preferences"),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const savePreferences = async (newPreferences: NotificationPreferences) => {
    setIsSaving(true);
    setError(null);
    setSavedMessage(false);

    // Optimistic update
    const previousPreferences = { ...preferences };
    setPreferences(newPreferences);

    try {
      const response = await apiFetch("/api/user/preferences/notifications", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(newPreferences),
      });

      if (!response.ok) {
        throw new ApiError("Failed to save preferences", response.status);
      }

      // Show success message briefly
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 3000);
    } catch (err) {
      // Rollback on error
      setPreferences(previousPreferences);
      setError(
        err instanceof Error ? err : new Error("Failed to save preferences"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggle = (key: keyof NotificationPreferences) => {
    const newPreferences = {
      ...preferences,
      [key]: !preferences[key],
    };
    savePreferences(newPreferences);
  };

  const handleTimeChange = (
    field: "quietHoursStart" | "quietHoursEnd",
    value: string,
  ) => {
    const newPreferences = {
      ...preferences,
      [field]: value,
    };
    savePreferences(newPreferences);
  };

  if (error && isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-2xl">
          <ErrorRetry error={error} onRetry={loadPreferences} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
            <Settings className="h-7 w-7 sm:h-8 sm:w-8 text-brand shrink-0" />
            <h1 className="text-2xl sm:text-3xl font-semibold text-foreground">
              Settings
            </h1>
          </div>
          <p className="text-muted">
            Manage your appearance, notification preferences and quiet hours.
          </p>
        </div>

        {savedMessage && (
          <div className="mb-6 rounded-xl border border-green-500/30 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            Preferences saved successfully
          </div>
        )}

        {error && !isLoading && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error.message}
          </div>
        )}

        <div className="mb-6">
          <AppearanceSettings />
        </div>

        {user && (
          <div className="mb-6">
            <BiometricAccessSettings userId={user.id} />
          </div>
        )}

        {user && <OAuthAccountsSettings />}

        {user && (
          <div className="mb-8">
            <ApiKeysSettings />
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 text-brand animate-spin" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Notification Categories */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Bell className="h-5 w-5" />
                Notification Categories
              </h2>
              <div className="space-y-4">
                {notificationCategories.map((category) => (
                  <div
                    key={category.id}
                    className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 py-3 border-b border-border last:border-b-0"
                  >
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        {category.label}
                      </h3>
                      <p className="text-xs text-muted">
                        {category.description}
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        handleToggle(
                          category.id as keyof NotificationPreferences,
                        )
                      }
                      disabled={isSaving}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-50 shrink-0 ${preferences[
                        category.id as keyof NotificationPreferences
                      ]
                        ? "bg-brand"
                        : "bg-border"
                        }`}
                      role="switch"
                      aria-checked={
                        preferences[
                        category.id as keyof NotificationPreferences
                        ] as boolean
                      }
                      aria-label={`Toggle ${category.label}`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences[
                          category.id as keyof NotificationPreferences
                        ]
                          ? "translate-x-6"
                          : "translate-x-1"
                          }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Browser Push Notifications */}
            <PushNotificationPanel eventTypes={notificationCategories} />

            {/* Quiet Hours */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Quiet Hours
              </h2>
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3 border-b border-border">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground mb-1">
                      Enable Quiet Hours
                    </h3>
                    <p className="text-xs text-muted">
                      Mute non-critical notifications during specified hours
                    </p>
                  </div>
                  <button
                    onClick={() => handleToggle("quietHoursEnabled")}
                    disabled={isSaving}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-50 shrink-0 ${preferences.quietHoursEnabled ? "bg-brand" : "bg-border"
                      }`}
                    role="switch"
                    aria-checked={preferences.quietHoursEnabled}
                    aria-label="Toggle quiet hours"
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${preferences.quietHoursEnabled
                        ? "translate-x-6"
                        : "translate-x-1"
                        }`}
                    />
                  </button>
                </div>

                {preferences.quietHoursEnabled && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                    <div>
                      <label
                        htmlFor="quietHoursStart"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        Start Time
                      </label>
                      <input
                        id="quietHoursStart"
                        type="time"
                        value={preferences.quietHoursStart}
                        onChange={(e) =>
                          handleTimeChange("quietHoursStart", e.target.value)
                        }
                        disabled={isSaving}
                        className="w-full rounded-xl border border-border bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="quietHoursEnd"
                        className="block text-sm font-medium text-foreground mb-2"
                      >
                        End Time
                      </label>
                      <input
                        id="quietHoursEnd"
                        type="time"
                        value={preferences.quietHoursEnd}
                        onChange={(e) =>
                          handleTimeChange("quietHoursEnd", e.target.value)
                        }
                        disabled={isSaving}
                        className="w-full rounded-xl border border-border bg-background px-4 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-brand/50 disabled:opacity-50"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Language */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
                <Globe className="h-5 w-5" />
                {t("language.title")}
              </h2>
              <p className="text-xs text-muted mb-4">
                {t("language.description")}
              </p>
              <LanguageSwitcher className="max-w-xs" />
            </div>

            {/* Additional Info */}
            <div className="rounded-xl bg-card/50 border border-border p-4 text-sm text-muted">
              <BellOff className="h-4 w-4 inline mr-2" />
              Critical security alerts will always be delivered, regardless of
              your preferences.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
