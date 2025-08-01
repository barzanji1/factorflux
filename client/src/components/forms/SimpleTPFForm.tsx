import { useState } from 'react';

interface SimpleTPFFormProps {
  className?: string;
  title?: string;
}

export function SimpleTPFForm({ className = '', title }: SimpleTPFFormProps) {
  const [isLoading, setIsLoading] = useState(true);

  const handleIframeLoad = () => {
    setIsLoading(false);
  };

  const handleIframeError = () => {
    setIsLoading(false);
  };

  return (
    <div className={`tpf-form-wrapper ${className}`}>
      {title && (
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        </div>
      )}
      
      <div className="relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-800 z-10">
            <div className="flex items-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
              <span className="ml-3 text-gray-600 dark:text-gray-300">Loading TPF form...</span>
            </div>
          </div>
        )}
        
        <iframe
          src="https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html"
          className="w-full h-[800px] border-0"
          title="TPF Application Form"
          onLoad={handleIframeLoad}
          onError={handleIframeError}
          sandbox="allow-forms allow-scripts allow-same-origin allow-popups"
          style={{
            minHeight: '600px',
            backgroundColor: 'white'
          }}
        />
      </div>
      
      <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
        <p>
          This form is securely hosted by Trucking Pros Financial. 
          If you experience any loading issues, please{' '}
          <a 
            href="https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-700 underline"
          >
            open the form in a new window
          </a>.
        </p>
      </div>
    </div>
  );
}