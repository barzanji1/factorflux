import { useState, useEffect } from 'react';

export interface DeviceInfo {
  platform: 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'unknown';
  browser: string;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  userAgent: string;
  recommendedDownload: {
    platform: string;
    url: string;
    filename: string;
    size: string;
    icon: string;
  } | null;
}

export function useDeviceDetection(): DeviceInfo {
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo>({
    platform: 'unknown',
    browser: '',
    isMobile: false,
    isTablet: false,
    isDesktop: false,
    userAgent: '',
    recommendedDownload: null
  });

  useEffect(() => {
    const userAgent = navigator.userAgent;
    const platform = navigator.platform.toLowerCase();
    
    // Detect platform
    let detectedPlatform: DeviceInfo['platform'] = 'unknown';
    if (userAgent.includes('Windows') || platform.includes('win')) {
      detectedPlatform = 'windows';
    } else if (userAgent.includes('Mac') || platform.includes('mac')) {
      detectedPlatform = 'mac';
    } else if (userAgent.includes('Linux') || platform.includes('linux')) {
      detectedPlatform = 'linux';
    } else if (userAgent.includes('Android')) {
      detectedPlatform = 'android';
    } else if (userAgent.includes('iPhone') || userAgent.includes('iPad')) {
      detectedPlatform = 'ios';
    }

    // Detect browser
    let browser = 'Unknown';
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
      browser = 'Chrome';
    } else if (userAgent.includes('Firefox')) {
      browser = 'Firefox';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
      browser = 'Safari';
    } else if (userAgent.includes('Edg')) {
      browser = 'Edge';
    }

    // Detect device type
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
    const isTablet = /iPad|Android(?=.*\bMobile\b)(?=.*\bTablet\b)|tablet/i.test(userAgent);
    const isDesktop = !isMobile && !isTablet;

    // Get recommended download
    const baseUrl = window.location.origin;
    let recommendedDownload: DeviceInfo['recommendedDownload'] = null;

    if (detectedPlatform === 'windows') {
      recommendedDownload = {
        platform: 'Windows',
        url: `${baseUrl}/api/desktop/download/windows`,
        filename: 'QuantumCore-Windows-Portable.tar.gz',
        size: '5.7 MB',
        icon: '🪟'
      };
    } else if (detectedPlatform === 'mac') {
      recommendedDownload = {
        platform: 'macOS',
        url: `${baseUrl}/api/desktop/download/mac`,
        filename: 'QuantumCore-Mac-Portable.tar.gz',
        size: '5.7 MB',
        icon: '🍎'
      };
    } else if (detectedPlatform === 'linux') {
      recommendedDownload = {
        platform: 'Linux',
        url: `${baseUrl}/api/desktop/download/linux`,
        filename: 'QuantumCore-Linux-Portable.tar.gz',
        size: '5.7 MB',
        icon: '🐧'
      };
    }

    setDeviceInfo({
      platform: detectedPlatform,
      browser,
      isMobile,
      isTablet,
      isDesktop,
      userAgent,
      recommendedDownload
    });
  }, []);

  return deviceInfo;
}