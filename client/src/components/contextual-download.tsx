import { useDeviceDetection } from '@/hooks/useDeviceDetection';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Badge } from '@/components/admin-neu/adapters';
import { Download, Monitor, Smartphone, Tablet, Globe, ExternalLink } from 'lucide-react';

interface ContextualDownloadProps {
  showAllOptions?: boolean;
  compact?: boolean;
}

export default function ContextualDownload({ showAllOptions = false, compact = false }: ContextualDownloadProps) {
  const deviceInfo = useDeviceDetection();

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {deviceInfo.recommendedDownload ? (
          <>
            <Badge variant="secondary" className="flex items-center gap-1">
              {deviceInfo.recommendedDownload.icon} {deviceInfo.recommendedDownload.platform} Detected
            </Badge>
            <Button
              size="sm"
              onClick={() => window.open(deviceInfo.recommendedDownload!.url, '_blank')}
              className="flex items-center gap-1"
            >
              <Download className="h-4 w-4" />
              Download ({deviceInfo.recommendedDownload.size})
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.open(window.location.origin, '_blank')}
            className="flex items-center gap-1"
          >
            <Globe className="h-4 w-4" />
            Use Web Version
          </Button>
        )}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="h-5 w-5" />
          Recommended for Your Device
        </CardTitle>
        <CardDescription>
          {deviceInfo.isMobile ? (
            <span className="flex items-center gap-1">
              <Smartphone className="h-4 w-4" />
              Mobile device detected - Web version recommended
            </span>
          ) : deviceInfo.isTablet ? (
            <span className="flex items-center gap-1">
              <Tablet className="h-4 w-4" />
              Tablet detected - Web version optimized for your screen
            </span>
          ) : (
            <span className="flex items-center gap-1">
              <Monitor className="h-4 w-4" />
              Desktop detected - Download for offline access
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recommended Option */}
        <div className="rounded-2xl bg-[#e0e0e0] p-4 shadow-[inset_5px_5px_10px_#b8b8b8,inset_-5px_-5px_10px_#fff]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e0e0e0] text-lg shadow-[4px_4px_8px_#c1c1c1,-4px_-4px_8px_#fff]">
                {deviceInfo.recommendedDownload?.icon || '🌐'}
              </div>
              <div>
                <p className="font-semibold text-[#333]">
                  {deviceInfo.recommendedDownload ? (
                    `${deviceInfo.recommendedDownload.platform} Desktop App`
                  ) : (
                    'Web Application'
                  )}
                </p>
                <p className="text-sm text-[#777]">
                  {deviceInfo.recommendedDownload ? (
                    `Optimized for ${deviceInfo.recommendedDownload.platform} • ${deviceInfo.recommendedDownload.size}`
                  ) : (
                    `Works perfectly in ${deviceInfo.browser} • No download required`
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="accent">Recommended</Badge>
              <Button
                onClick={() => {
                  if (deviceInfo.recommendedDownload) {
                    window.open(deviceInfo.recommendedDownload.url, '_blank');
                  } else {
                    window.open(window.location.origin, '_blank');
                  }
                }}
              >
                {deviceInfo.recommendedDownload ? (
                  <>
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </>
                ) : (
                  <>
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Open App
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Device Info */}
        <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">
            {deviceInfo.isDesktop ? 'Desktop' : deviceInfo.isMobile ? 'Mobile' : 'Tablet'}
          </Badge>
          <Badge variant="outline">{deviceInfo.platform}</Badge>
          <Badge variant="outline">{deviceInfo.browser}</Badge>
        </div>

        {/* Alternative Options */}
        {showAllOptions && (
          <div className="pt-4 border-t">
            <h4 className="font-medium mb-3">Other Options</h4>
            <div className="grid gap-2">
              {deviceInfo.platform !== 'windows' && (
                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted">
                  <div className="flex items-center gap-2">
                    <span>🪟</span>
                    <span className="text-sm">Windows Desktop</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`${window.location.origin}/api/desktop/download/windows`, '_blank')}
                  >
                    Download
                  </Button>
                </div>
              )}
              {deviceInfo.platform !== 'mac' && (
                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted">
                  <div className="flex items-center gap-2">
                    <span>🍎</span>
                    <span className="text-sm">macOS Desktop</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`${window.location.origin}/api/desktop/download/mac`, '_blank')}
                  >
                    Download
                  </Button>
                </div>
              )}
              {deviceInfo.platform !== 'linux' && (
                <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted">
                  <div className="flex items-center gap-2">
                    <span>🐧</span>
                    <span className="text-sm">Linux Desktop</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(`${window.location.origin}/api/desktop/download/linux`, '_blank')}
                  >
                    Download
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between p-2 rounded-lg hover:bg-muted">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  <span className="text-sm">Web Application</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(window.location.origin, '_blank')}
                >
                  Open
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Browser-specific instructions */}
        {deviceInfo.isDesktop && (
          <div className="rounded-xl bg-[#e0e0e0] p-3 shadow-[inset_4px_4px_8px_#b8b8b8,inset_-4px_-4px_8px_#fff]">
            <p className="text-sm font-medium mb-2">Create Desktop Shortcut:</p>
            <p className="text-xs text-muted-foreground">
              {deviceInfo.browser === 'Chrome' && 'Menu → More Tools → Create Shortcut → Check "Open as window"'}
              {deviceInfo.browser === 'Edge' && 'Menu → Apps → Install this site as an app'}
              {deviceInfo.browser === 'Safari' && 'Share → Add to Dock'}
              {deviceInfo.browser === 'Firefox' && 'Right-click → Create Desktop Shortcut'}
              {!['Chrome', 'Edge', 'Safari', 'Firefox'].includes(deviceInfo.browser) && 
                'Check your browser menu for "Add to Desktop" or "Create Shortcut" options'}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}