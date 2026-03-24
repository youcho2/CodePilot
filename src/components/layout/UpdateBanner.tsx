"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useUpdate } from "@/hooks/useUpdate";
import { useTranslation } from "@/hooks/useTranslation";

function getRosettaDismissKey(assetName: string, version: string): string {
  return `codepilot:rosetta-warning-dismissed:${assetName || version || 'unknown'}`;
}

export function UpdateBanner() {
  const { updateInfo, quitAndInstall } = useUpdate();
  const { t } = useTranslation();
  const [dismissedRosetta, setDismissedRosetta] = useState(false);

  const rosettaDismissKey = useMemo(
    () => getRosettaDismissKey(updateInfo?.downloadAssetName || '', updateInfo?.latestVersion || ''),
    [updateInfo?.downloadAssetName, updateInfo?.latestVersion],
  );

  useEffect(() => {
    if (!updateInfo?.runningUnderRosetta) {
      setDismissedRosetta(false);
      return;
    }

    try {
      setDismissedRosetta(localStorage.getItem(rosettaDismissKey) === '1');
    } catch {
      setDismissedRosetta(false);
    }
  }, [rosettaDismissKey, updateInfo?.runningUnderRosetta]);

  const dismissRosettaWarning = () => {
    try {
      localStorage.setItem(rosettaDismissKey, '1');
    } catch {
      // ignore persistence failures
    }
    setDismissedRosetta(true);
  };

  const openRecommendedDownload = () => {
    if (!updateInfo) return;
    window.open(updateInfo.downloadUrl || updateInfo.releaseUrl, '_blank');
  };

  const showRosettaWarning = !!updateInfo?.runningUnderRosetta && !dismissedRosetta;
  const showReadyBanner = !!updateInfo?.isNativeUpdate && !!updateInfo.readyToInstall;

  if (!showRosettaWarning && !showReadyBanner) return null;

  return (
    <>
      {showRosettaWarning && updateInfo && (
        <div className="flex items-center justify-center gap-3 border-b border-status-warning-border/50 bg-status-warning-muted px-4 py-2 text-sm text-status-warning-foreground">
          <span>{t('update.rosettaWarning')}</span>
          {updateInfo.downloadAssetName && (
            <span className="text-xs opacity-80">
              {t('update.recommendedAsset', { asset: updateInfo.downloadAssetName })}
            </span>
          )}
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={openRecommendedDownload}>
            {t('update.getRecommendedBuild')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={dismissRosettaWarning}>
            {t('update.later')}
          </Button>
        </div>
      )}

      {showReadyBanner && updateInfo && (
        <div className="flex items-center justify-center gap-3 border-b border-primary/20 bg-primary/10 px-4 py-1.5 text-sm">
          <span>{t('update.readyToInstall', { version: updateInfo.latestVersion })}</span>
          <Button size="sm" variant="outline" className="h-6 text-xs" onClick={quitAndInstall}>
            {t('update.restartNow')}
          </Button>
        </div>
      )}
    </>
  );
}
