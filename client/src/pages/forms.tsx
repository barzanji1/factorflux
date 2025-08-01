import TopNav from '@/components/layout/top-nav';

export default function Forms() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopNav 
        title="TPF Forms" 
        subtitle="Access Trucking Pros Financial forms and applications"
      />
      
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Main TPF Form */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                TPF Application Form
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                Complete your application or request services directly through our secure TPF portal.
              </p>
            </div>
            
            {/* Direct HTML Embed for TPF Form */}
            <div className="bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700">
              <div 
                id="frmapi-5QOP-LWPL-QOT0-H74Y" 
                className="frmapi-form" 
                data-url="https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html"
              >
                <div className="flex items-center justify-center p-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  <span className="ml-3 text-gray-600 dark:text-gray-300">Loading TPF form...</span>
                </div>
              </div>
              
              {/* Load jQuery and initialize form */}
              <script 
                dangerouslySetInnerHTML={{
                  __html: `
                    if (typeof jQuery === 'undefined') {
                      var script = document.createElement('script');
                      script.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
                      script.onload = function() {
                        initializeTPFForm();
                      };
                      document.head.appendChild(script);
                    } else {
                      initializeTPFForm();
                    }
                    
                    function initializeTPFForm() {
                      jQuery(document).ready(function($) {
                        var frmapi = $('.frmapi-form');
                        if (frmapi.length) {
                          for (var frmi = 0, frmlen = frmapi.length; frmi < frmlen; frmi++) {
                            frmapiGetData($(frmapi[frmi]));
                          }
                        }
                      });
                      
                      function frmapiGetData(frmcont) {
                        jQuery.ajax({
                          dataType: 'json',
                          url: frmcont.data('url'),
                          success: function(json) {
                            frmcont.html(json.renderedHtml);
                          },
                          error: function(xhr, status, error) {
                            frmcont.html('<div class="p-4 bg-red-50 border border-red-200 rounded-lg"><p class="text-red-600">Failed to load form. <a href="' + frmcont.data('url') + '" target="_blank" class="underline">Open in new window</a></p></div>');
                          }
                        });
                      }
                    }
                  `
                }}
              />
            </div>
          </div>

          {/* Additional form sections can be added here */}
          {/* Alternative Embedded Form Approach */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                Direct Form Access
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                If the embedded form above doesn't load properly, you can access it directly through our secure portal.
              </p>
            </div>
            
            <div className="space-y-4">
              <a 
                href="https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html" 
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Open Form in New Window
                <svg className="ml-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6 border border-blue-200 dark:border-blue-800">
                <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">
                  Need Help?
                </h3>
                <p className="text-blue-700 dark:text-blue-200 mb-4">
                  If you experience any issues with the form, please contact our support team.
                </p>
                <div className="flex flex-wrap gap-4">
                  <a 
                    href="mailto:support@truckingprosfinancial.com" 
                    className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Email Support
                  </a>
                  <a 
                    href="tel:+1-800-TPF-HELP" 
                    className="inline-flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                  >
                    Call Support
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}