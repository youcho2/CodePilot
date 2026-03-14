"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SpinnerGap, CheckCircle, Warning } from "@/components/ui/icon";
import { useTranslation } from "@/hooks/useTranslation";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { StatusBanner } from "@/components/patterns/StatusBanner";

interface FeishuBridgeSettings {
  bridge_feishu_app_id: string;
  bridge_feishu_app_secret: string;
  bridge_feishu_domain: string;
  bridge_feishu_encrypt_key: string;
  bridge_feishu_verification_token: string;
  bridge_feishu_allow_from: string;
  bridge_feishu_dm_policy: string;
  bridge_feishu_render_mode: string;
  bridge_feishu_thread_session: string;
  bridge_feishu_block_streaming: string;
  bridge_feishu_footer_status: string;
  bridge_feishu_footer_elapsed: string;
  bridge_feishu_group_policy: string;
  bridge_feishu_group_allow_from: string;
  bridge_feishu_require_mention: string;
}

const DEFAULT_SETTINGS: FeishuBridgeSettings = {
  bridge_feishu_app_id: "",
  bridge_feishu_app_secret: "",
  bridge_feishu_domain: "feishu",
  bridge_feishu_encrypt_key: "",
  bridge_feishu_verification_token: "",
  bridge_feishu_allow_from: "",
  bridge_feishu_dm_policy: "open",
  bridge_feishu_render_mode: "auto",
  bridge_feishu_thread_session: "false",
  bridge_feishu_block_streaming: "false",
  bridge_feishu_footer_status: "false",
  bridge_feishu_footer_elapsed: "false",
  bridge_feishu_group_policy: "open",
  bridge_feishu_group_allow_from: "",
  bridge_feishu_require_mention: "false",
};

export function FeishuBridgeSection() {
  const [, setSettings] =
    useState<FeishuBridgeSettings>(DEFAULT_SETTINGS);
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [domain, setDomain] = useState("feishu");
  const [encryptKey, setEncryptKey] = useState("");
  const [verificationToken, setVerificationToken] = useState("");
  const [allowFrom, setAllowFrom] = useState("");
  const [dmPolicy, setDmPolicy] = useState("open");
  const [renderMode, setRenderMode] = useState("auto");
  const [threadSession, setThreadSession] = useState(false);
  const [blockStreaming, setBlockStreaming] = useState(false);
  const [footerStatus, setFooterStatus] = useState(false);
  const [footerElapsed, setFooterElapsed] = useState(false);
  const [groupPolicy, setGroupPolicy] = useState("open");
  const [groupAllowFrom, setGroupAllowFrom] = useState("");
  const [requireMention, setRequireMention] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const { t } = useTranslation();

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/feishu");
      if (res.ok) {
        const data = await res.json();
        const s = { ...DEFAULT_SETTINGS, ...data.settings };
        setSettings(s);
        setAppId(s.bridge_feishu_app_id);
        setAppSecret(s.bridge_feishu_app_secret);
        setDomain(s.bridge_feishu_domain || "feishu");
        setEncryptKey(s.bridge_feishu_encrypt_key || "");
        setVerificationToken(s.bridge_feishu_verification_token || "");
        setAllowFrom(s.bridge_feishu_allow_from);
        setDmPolicy(s.bridge_feishu_dm_policy || "open");
        setRenderMode(s.bridge_feishu_render_mode || "auto");
        setThreadSession(s.bridge_feishu_thread_session === "true");
        setBlockStreaming(s.bridge_feishu_block_streaming === "true");
        setFooterStatus(s.bridge_feishu_footer_status === "true");
        setFooterElapsed(s.bridge_feishu_footer_elapsed === "true");
        setGroupPolicy(s.bridge_feishu_group_policy || "open");
        setGroupAllowFrom(s.bridge_feishu_group_allow_from);
        setRequireMention(s.bridge_feishu_require_mention === "true");
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const saveSettings = async (updates: Partial<FeishuBridgeSettings>) => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/feishu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: updates }),
      });
      if (res.ok) {
        setSettings((prev) => ({ ...prev, ...updates }));
      }
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCredentials = () => {
    const updates: Partial<FeishuBridgeSettings> = {
      bridge_feishu_app_id: appId,
      bridge_feishu_domain: domain,
      bridge_feishu_verification_token: verificationToken,
    };
    if (appSecret && !appSecret.startsWith("***")) {
      updates.bridge_feishu_app_secret = appSecret;
    }
    if (encryptKey && !encryptKey.startsWith("***")) {
      updates.bridge_feishu_encrypt_key = encryptKey;
    }
    saveSettings(updates);
  };

  const handleSaveDmSettings = () => {
    saveSettings({
      bridge_feishu_allow_from: allowFrom,
      bridge_feishu_dm_policy: dmPolicy,
    });
  };

  const handleSaveBehaviorSettings = () => {
    saveSettings({
      bridge_feishu_render_mode: renderMode,
      bridge_feishu_thread_session: threadSession ? "true" : "false",
      bridge_feishu_block_streaming: blockStreaming ? "true" : "false",
      bridge_feishu_footer_status: footerStatus ? "true" : "false",
      bridge_feishu_footer_elapsed: footerElapsed ? "true" : "false",
    });
  };

  const handleSaveGroupSettings = () => {
    saveSettings({
      bridge_feishu_group_policy: groupPolicy,
      bridge_feishu_group_allow_from: groupAllowFrom,
      bridge_feishu_require_mention: requireMention ? "true" : "false",
    });
  };

  const handleVerify = async () => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      if (!appId) {
        setVerifyResult({
          ok: false,
          message: t("feishu.enterCredentialsFirst"),
        });
        return;
      }

      const res = await fetch("/api/settings/feishu/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: appId,
          app_secret: appSecret,
          domain,
        }),
      });
      const data = await res.json();

      if (data.verified) {
        setVerifyResult({
          ok: true,
          message: data.botName
            ? t("feishu.verifiedAs", { name: data.botName })
            : t("feishu.verified"),
        });
      } else {
        setVerifyResult({
          ok: false,
          message: data.error || t("feishu.verifyFailed"),
        });
      }
    } catch {
      setVerifyResult({ ok: false, message: t("feishu.verifyFailed") });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      {/* App Credentials */}
      <SettingsCard
        title={t("feishu.credentials")}
        description={t("feishu.credentialsDesc")}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.appId")}
            </label>
            <Input
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="cli_xxxxxxxxxx"
              className="font-mono text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.appSecret")}
            </label>
            <Input
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxx"
              className="font-mono text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.domain")}
            </label>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="feishu">
                  {t("feishu.domainFeishu")}
                </SelectItem>
                <SelectItem value="lark">
                  {t("feishu.domainLark")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {t("feishu.domainHint")}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.encryptKey")}
            </label>
            <Input
              type="password"
              value={encryptKey}
              onChange={(e) => setEncryptKey(e.target.value)}
              placeholder={t("feishu.encryptKeyPlaceholder")}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("feishu.encryptKeyHint")}
            </p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.verificationToken")}
            </label>
            <Input
              value={verificationToken}
              onChange={(e) => setVerificationToken(e.target.value)}
              placeholder={t("feishu.verificationTokenPlaceholder")}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("feishu.verificationTokenHint")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSaveCredentials} disabled={saving}>
            {saving ? t("common.loading") : t("common.save")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleVerify}
            disabled={verifying || !appId}
          >
            {verifying ? (
              <SpinnerGap
                size={14}
                className="animate-spin mr-1.5"
              />
            ) : null}
            {t("feishu.verify")}
          </Button>
        </div>

        {verifyResult && (
          <StatusBanner
            variant={verifyResult.ok ? "success" : "error"}
            icon={verifyResult.ok ? <CheckCircle size={16} className="shrink-0" /> : <Warning size={16} className="shrink-0" />}
          >
            {verifyResult.message}
          </StatusBanner>
        )}
      </SettingsCard>

      {/* DM Policy & Allow From */}
      <SettingsCard
        title={t("feishu.allowFrom")}
        description={t("feishu.allowFromDesc")}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.dmPolicy")}
            </label>
            <Select value={dmPolicy} onValueChange={setDmPolicy}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  {t("feishu.dmPolicyOpen")}
                </SelectItem>
                <SelectItem value="pairing">
                  {t("feishu.dmPolicyPairing")}
                </SelectItem>
                <SelectItem value="allowlist">
                  {t("feishu.dmPolicyAllowlist")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("feishu.dmPolicyDisabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Input
              value={allowFrom}
              onChange={(e) => setAllowFrom(e.target.value)}
              placeholder="*, ou_xxxxxxxxxx, ou_yyyyyyyyyy"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t("feishu.allowFromHint")}
            </p>
          </div>
        </div>

        <Button size="sm" onClick={handleSaveDmSettings} disabled={saving}>
          {saving ? t("common.loading") : t("common.save")}
        </Button>
      </SettingsCard>

      {/* Behavior Settings: Render Mode, Thread Session, Block Streaming, Footer */}
      <SettingsCard
        title={t("feishu.renderMode")}
        description={t("feishu.renderModeDesc")}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.renderMode")}
            </label>
            <Select value={renderMode} onValueChange={setRenderMode}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">
                  {t("feishu.renderModeAuto")}
                </SelectItem>
                <SelectItem value="static">
                  {t("feishu.renderModeStatic")}
                </SelectItem>
                <SelectItem value="streaming">
                  {t("feishu.renderModeStreaming")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <FieldRow
            label={t("feishu.threadSession")}
            description={t("feishu.threadSessionDesc")}
          >
            <Switch
              checked={threadSession}
              onCheckedChange={setThreadSession}
            />
          </FieldRow>

          <FieldRow
            label={t("feishu.blockStreaming")}
            description={t("feishu.blockStreamingDesc")}
          >
            <Switch
              checked={blockStreaming}
              onCheckedChange={setBlockStreaming}
            />
          </FieldRow>

          <FieldRow
            label={t("feishu.footer")}
            description=""
          >
            <div className="flex flex-col gap-2">
              <FieldRow
                label={t("feishu.footerStatus")}
                description=""
              >
                <Switch
                  checked={footerStatus}
                  onCheckedChange={setFooterStatus}
                />
              </FieldRow>
              <FieldRow
                label={t("feishu.footerElapsed")}
                description=""
              >
                <Switch
                  checked={footerElapsed}
                  onCheckedChange={setFooterElapsed}
                />
              </FieldRow>
            </div>
          </FieldRow>
        </div>

        <Button size="sm" onClick={handleSaveBehaviorSettings} disabled={saving}>
          {saving ? t("common.loading") : t("common.save")}
        </Button>
      </SettingsCard>

      {/* Group Chat Settings */}
      <SettingsCard
        title={t("feishu.groupSettings")}
        description={t("feishu.groupSettingsDesc")}
      >
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              {t("feishu.groupPolicy")}
            </label>
            <Select value={groupPolicy} onValueChange={setGroupPolicy}>
              <SelectTrigger className="w-full text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">
                  {t("feishu.groupPolicyOpen")}
                </SelectItem>
                <SelectItem value="allowlist">
                  {t("feishu.groupPolicyAllowlist")}
                </SelectItem>
                <SelectItem value="disabled">
                  {t("feishu.groupPolicyDisabled")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {groupPolicy === "allowlist" && (
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1 block">
                {t("feishu.groupAllowFrom")}
              </label>
              <Input
                value={groupAllowFrom}
                onChange={(e) => setGroupAllowFrom(e.target.value)}
                placeholder="oc_xxxxxxxxxx, oc_yyyyyyyyyy"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {t("feishu.groupAllowFromHint")}
              </p>
            </div>
          )}

          <FieldRow
            label={t("feishu.requireMention")}
            description={t("feishu.requireMentionDesc")}
          >
            <Switch
              checked={requireMention}
              onCheckedChange={setRequireMention}
            />
          </FieldRow>
        </div>

        <Button size="sm" onClick={handleSaveGroupSettings} disabled={saving}>
          {saving ? t("common.loading") : t("common.save")}
        </Button>
      </SettingsCard>

      {/* Setup Guide */}
      <SettingsCard title={t("feishu.setupGuide")}>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
          <li>{t("feishu.step1")}</li>
          <li>{t("feishu.step2")}</li>
          <li>{t("feishu.step3")}</li>
          <li>{t("feishu.step4")}</li>
          <li>{t("feishu.step5")}</li>
          <li>{t("feishu.step6")}</li>
        </ol>
      </SettingsCard>
    </div>
  );
}
