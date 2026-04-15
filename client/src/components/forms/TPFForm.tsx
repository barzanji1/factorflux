import { useEffect, useRef, useState } from 'react';

interface TPFFormProps {
  formId: string;
  viewId: string;
  className?: string;
  title?: string;
}

export function TPFForm({ formId, viewId, className = '', title }: TPFFormProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const initializeForm = () => {
      const $ = (window as any).jQuery;
      
      if (containerRef.current && $) {
        const $container = $(containerRef.current);
        
        // Clear any existing content
        $container.empty();
        
        // Add loading state
        setIsLoading(true);
        setError(null);
        
        // Function to fetch and load form data
        const frmapiGetData = (frmcont: any) => {
          $.ajax({
            dataType: 'json',
            url: frmcont.data('url'),
            timeout: 10000, // 10 second timeout
            success: function(json: any) {
              if (json && json.renderedHtml) {
                frmcont.html(json.renderedHtml);
                setIsLoading(false);
                
                // Apply custom styling to the loaded form
                setTimeout(() => {
                  const formElements = frmcont.find('input, select, textarea, button');
                  formElements.addClass('form-control');
                  
                  // Style form inputs with Tailwind classes
                  frmcont.find('input[type="text"], input[type="email"], input[type="tel"], textarea, select').each(function(this: any) {
                    $(this).addClass('w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white');
                  });
                  
                  // Style submit buttons
                  frmcont.find('input[type="submit"], button[type="submit"]').each(function(this: any) {
                    $(this).addClass('bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors');
                  });
                  
                  // Style labels
                  frmcont.find('label').each(function(this: any) {
                    $(this).addClass('block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2');
                  });
                }, 100);
              } else {
                setError('Form data is invalid or empty.');
                setIsLoading(false);
              }
            },
            error: function(xhr: any, status: string, error: string) {
              console.error('TPF Form loading error:', error, status, xhr);
              let errorMessage = 'Failed to load form. ';
              
              if (status === 'timeout') {
                errorMessage += 'The request timed out. Please check your connection and try again.';
              } else if (xhr.status === 404) {
                errorMessage += 'Form not found. Please check the form ID.';
              } else if (xhr.status === 0) {
                errorMessage += 'Network error. Please check your internet connection.';
              } else {
                errorMessage += `Server error (${xhr.status}): ${error}`;
              }
              
              setError(errorMessage);
              setIsLoading(false);
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
        // Small delay to ensure jQuery is fully loaded
        timeoutId = setTimeout(initializeForm, 100);
      };
      script.onerror = () => {
        setError('Failed to load jQuery. Please refresh the page and try again.');
        setIsLoading(false);
      };
      document.head.appendChild(script);
    } else {
      // Small delay to ensure DOM is ready
      timeoutId = setTimeout(initializeForm, 100);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
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
        className="frmapi-form bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 min-h-[200px]"
        data-url={dataUrl}
      >
        {isLoading && (
          <div className="flex items-center justify-center p-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
            <span className="ml-3 text-gray-600 dark:text-gray-300">Loading TPF form...</span>
          </div>
        )}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h4 className="text-sm font-medium text-red-800 dark:text-red-200">
                  Form Loading Error
                </h4>
                <p className="text-sm text-red-600 dark:text-red-400 mt-1">
                  {error}
                </p>
                <button 
                  onClick={() => window.location.reload()} 
                  className="mt-2 text-sm text-red-600 dark:text-red-400 underline hover:text-red-800 dark:hover:text-red-200"
                >
                  Refresh page
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}