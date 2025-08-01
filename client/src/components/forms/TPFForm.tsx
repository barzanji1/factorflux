import { useEffect, useRef } from 'react';

interface TPFFormProps {
  formId: string;
  viewId: string;
  className?: string;
  title?: string;
}

export function TPFForm({ formId, viewId, className = '', title }: TPFFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const initializeForm = () => {
      const $ = (window as any).jQuery;
      
      if (containerRef.current && $) {
        const $container = $(containerRef.current);
        
        // Clear any existing content
        $container.empty();
        
        // Function to fetch and load form data
        const frmapiGetData = (frmcont: any) => {
          $.ajax({
            dataType: 'json',
            url: frmcont.data('url'),
            success: function(json: any) {
              frmcont.html(json.renderedHtml);
            },
            error: function(xhr: any, status: string, error: string) {
              console.error('TPF Form loading error:', error);
              frmcont.html('<div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"><p class="text-red-600 dark:text-red-400">Failed to load form. Please try again later.</p></div>');
            }
          });
        };

        // Initialize the form
        frmapiGetData($container);
      }
    };

    // Ensure jQuery is available globally
    if (typeof (window as any).jQuery === 'undefined') {
      // Load jQuery if not available
      const script = document.createElement('script');
      script.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
      script.onload = () => {
        initializeForm();
      };
      document.head.appendChild(script);
    } else {
      initializeForm();
    }
  }, [formId, viewId]);

  const dataUrl = `https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/${viewId}?return=html`;

  return (
    <div className={`tpf-form-wrapper ${className}`}>
      {title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        </div>
      )}
      <div
        ref={containerRef}
        id={`frmapi-${formId}`}
        className="frmapi-form bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
        data-url={dataUrl}
      >
        {/* Loading placeholder */}
        <div className="flex items-center justify-center p-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-300">Loading form...</span>
        </div>
      </div>
    </div>
  );
}