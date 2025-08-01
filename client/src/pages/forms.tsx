import TopNav from '@/components/layout/top-nav';
import { Link } from 'wouter';
import { NativeTPFForm } from '@/components/forms/NativeTPFForm';

export default function Forms() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopNav 
        title="TPF Forms" 
        subtitle="Access Trucking Pros Financial forms and applications"
      />
      
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Home Button */}
          <div className="flex justify-end">
            <Link href="/">
              <button className="flex items-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors shadow-sm">
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Home
              </button>
            </Link>
          </div>
          {/* External TPF Form Integration */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-8">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
                TPF Payment Details
              </h2>
              <p className="text-gray-600 dark:text-gray-300">
                View payment information and account details from Trucking Pros Financial.
              </p>
            </div>
            
            <div 
              id="frmapi-5QOP-LWPL-QOT0-H74Y" 
              className="frmapi-form min-h-[400px] p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700" 
              data-url="https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html"
            >
              <div className="flex items-center justify-center p-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                <span className="ml-3 text-gray-600 dark:text-gray-300">Loading TPF form...</span>
              </div>
            </div>
            
            <script 
              dangerouslySetInnerHTML={{
                __html: `
                  // Load jQuery if not available
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
                    jQuery(document).ready(function($){
                      var frmapi = $('.frmapi-form');
                      if(frmapi.length){
                        for(var frmi = 0, frmlen = frmapi.length; frmi < frmlen; frmi++){
                          frmapiGetData($(frmapi[frmi]));
                        }
                      }
                    });
                    
                    function frmapiGetData(frmcont){
                      jQuery.ajax({
                        dataType: 'json',
                        url: frmcont.data('url'),
                        timeout: 15000,
                        crossDomain: true,
                        success: function(json){
                          console.log('TPF API Response:', json);
                          if (json && json.renderedHtml) {
                            frmcont.html(json.renderedHtml);
                            
                            // Apply styling to payment details and tables
                            setTimeout(function() {
                              // Style tables for payment data
                              frmcont.find('table').addClass('w-full border-collapse border border-gray-300 dark:border-gray-600 rounded-lg overflow-hidden');
                              frmcont.find('th').addClass('bg-gray-100 dark:bg-gray-700 px-4 py-2 text-left font-medium text-gray-900 dark:text-white border-b border-gray-300 dark:border-gray-600');
                              frmcont.find('td').addClass('px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white');
                              
                              // Style form elements if present
                              frmcont.find('input, select, textarea').addClass('w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white');
                              frmcont.find('input[type="submit"], button[type="submit"]').addClass('bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors');
                              frmcont.find('label').addClass('block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2');
                              
                              // Style payment information containers
                              frmcont.find('.payment-info, .account-details, .invoice-details').addClass('bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 mb-4');
                            }, 500);
                          } else if (json && typeof json === 'object') {
                            // Handle if JSON contains payment data directly
                            var paymentHtml = '<div class="payment-details-container">';
                            paymentHtml += '<h3 class="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Payment Information</h3>';
                            
                            if (json.data && Array.isArray(json.data)) {
                              paymentHtml += '<div class="grid gap-4">';
                              json.data.forEach(function(item, index) {
                                paymentHtml += '<div class="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">';
                                for (var key in item) {
                                  if (item.hasOwnProperty(key)) {
                                    paymentHtml += '<div class="flex justify-between py-1"><span class="font-medium text-gray-700 dark:text-gray-300">' + key + ':</span><span class="text-gray-900 dark:text-white">' + item[key] + '</span></div>';
                                  }
                                }
                                paymentHtml += '</div>';
                              });
                              paymentHtml += '</div>';
                            } else {
                              for (var key in json) {
                                if (json.hasOwnProperty(key) && key !== 'renderedHtml') {
                                  paymentHtml += '<div class="flex justify-between py-2 border-b border-gray-200 dark:border-gray-600"><span class="font-medium text-gray-700 dark:text-gray-300">' + key + ':</span><span class="text-gray-900 dark:text-white">' + json[key] + '</span></div>';
                                }
                              }
                            }
                            paymentHtml += '</div>';
                            frmcont.html(paymentHtml);
                          } else {
                            frmcont.html('<div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg"><p class="text-yellow-600 dark:text-yellow-400">Payment data is not available. Please use the external portal link below.</p></div>');
                          }
                        },
                        error: function(xhr, status, error) {
                          console.error('TPF Form loading error:', {
                            error: error,
                            status: status,
                            statusText: xhr.statusText,
                            responseText: xhr.responseText,
                            readyState: xhr.readyState
                          });
                          
                          var errorMsg = 'Failed to load payment details. ';
                          if (status === 'timeout') {
                            errorMsg += 'Request timed out.';
                          } else if (xhr.status === 0) {
                            errorMsg += 'Network error or CORS restriction.';
                          } else if (xhr.status === 404) {
                            errorMsg += 'Payment data not found.';
                          } else {
                            errorMsg += 'Server error (' + xhr.status + ').';
                          }
                          
                          frmcont.html('<div class="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg"><p class="text-red-600 dark:text-red-400">' + errorMsg + '</p><p class="text-sm text-red-500 dark:text-red-300 mt-2">Please use the external portal link below or contact support.</p></div>');
                        }
                      });
                    }
                  }
                `
              }}
            />
          </div>
          
          {/* Direct API Test Section */}
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-6 border border-yellow-200 dark:border-yellow-800 mb-8">
            <h3 className="text-lg font-semibold text-yellow-800 dark:text-yellow-200 mb-3">
              API Connection Test
            </h3>
            <p className="text-yellow-700 dark:text-yellow-300 mb-4">
              Testing connection to TPF payment API...
            </p>
            <button 
              id="test-api-btn"
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
              onClick={() => {
                const testBtn = document.getElementById('test-api-btn');
                const testResult = document.getElementById('api-test-result');
                
                if (testBtn && testResult) {
                  testBtn.textContent = 'Testing...';
                  (testBtn as HTMLButtonElement).disabled = true;
                  
                  fetch('https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html')
                    .then(response => {
                      console.log('Fetch response status:', response.status);
                      return response.json();
                    })
                    .then(data => {
                      console.log('Fetch response data:', data);
                      testResult.innerHTML = '<div class="mt-4 p-3 bg-green-100 dark:bg-green-900/30 rounded border border-green-300 dark:border-green-700"><p class="text-green-800 dark:text-green-200">✓ API connection successful</p><pre class="text-xs mt-2 overflow-auto">' + JSON.stringify(data, null, 2) + '</pre></div>';
                    })
                    .catch(error => {
                      console.error('Fetch error:', error);
                      testResult.innerHTML = '<div class="mt-4 p-3 bg-red-100 dark:bg-red-900/30 rounded border border-red-300 dark:border-red-700"><p class="text-red-800 dark:text-red-200">✗ API connection failed: ' + error.message + '</p></div>';
                    })
                    .finally(() => {
                      testBtn.textContent = 'Test API Connection';
                      (testBtn as HTMLButtonElement).disabled = false;
                    });
                }
              }}
            >
              Test API Connection
            </button>
            <div id="api-test-result"></div>
          </div>
          
          {/* Backup Native TPF Application Form */}
          <details className="mb-8">
            <summary className="cursor-pointer p-4 bg-gray-100 dark:bg-gray-700 rounded-lg text-gray-900 dark:text-white font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
              Alternative: Use Native Application Form
            </summary>
            <div className="mt-4">
              <NativeTPFForm />
            </div>
          </details>
          
          {/* External TPF Portal Access */}
          <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-8 text-white shadow-xl">
            <div className="text-center">
              <div className="mb-6">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-white/20 rounded-full mb-4">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold mb-2">Need Additional Services?</h3>
                <p className="text-blue-100 max-w-md mx-auto">
                  Access the full TPF portal for additional forms, account management, and specialized services.
                </p>
              </div>
              
              <a 
                href="https://secure.truckingprosfinancial.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center px-8 py-4 bg-white text-blue-600 font-semibold rounded-lg hover:bg-gray-50 transition-colors shadow-lg"
              >
                <svg className="mr-3 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Access Full TPF Portal
                <svg className="ml-3 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
              
              <p className="text-blue-100 text-sm mt-4">
                Opens in a new secure window
              </p>
            </div>
          </div>

          {/* Support Section */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6 border border-green-200 dark:border-green-800">
            <h3 className="text-lg font-semibold text-green-900 dark:text-green-100 mb-2">
              Need Assistance?
            </h3>
            <p className="text-green-700 dark:text-green-200 mb-4">
              Our support team is available to help you with forms, applications, and any questions about TPF services.
            </p>
            <div className="flex flex-wrap gap-4">
              <a 
                href="mailto:support@truckingprosfinancial.com" 
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Email Support
              </a>
              <a 
                href="tel:+1-800-TPF-HELP" 
                className="inline-flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                <svg className="mr-2 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call Support
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}