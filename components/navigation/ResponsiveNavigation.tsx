import React from 'react';
import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';
import MobileTabContainer from './MobileTabContainer';
import TabletSidebarNavigator from './TabletSidebarNavigator';

interface ResponsiveNavigationProps {
  children: React.ReactNode;
  /** 沉浸式全屏：隐藏底栏/侧栏，但不改变组件树 */
  hideChrome?: boolean;
}

const ResponsiveNavigation: React.FC<ResponsiveNavigationProps> = ({ children, hideChrome = false }) => {
  const { deviceType } = useResponsiveLayout();

  switch (deviceType) {
    case 'mobile':
      // 移动端使用Tab容器包装children
      return <MobileTabContainer hideChrome={hideChrome}>{children}</MobileTabContainer>;
    
    case 'tablet':
      return (
        <TabletSidebarNavigator hideChrome={hideChrome}>
          {children}
        </TabletSidebarNavigator>
      );
    
    case 'tv':
    default:
      // TV端保持原有的Stack导航，不需要额外的导航容器
      return <>{children}</>;
  }
};

export default ResponsiveNavigation;