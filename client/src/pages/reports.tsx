import TopNav from '@/components/layout/top-nav';
import { Link } from 'wouter';
import { NativeTPFForm } from '@/components/forms/NativeTPFForm';
import { useEffect, useState } from 'react';

export default function Reports() {
  const [paymentData, setPaymentData] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    // Load TPF payment data directly
    fetch('https://secure.truckingprosfinancial.com/wp-json/frm/v2/views/82676?return=html')
      .then(response => response.json())
      .then(data => {
        console.log('TPF Payment Data:', data);
        if (data && data.renderedHtml) {
          setPaymentData(data.renderedHtml);
        } else {
          setError('No payment data available');
        }
      })
      .catch(err => {
        console.error('TPF Loading Error:', err);
        setError('Failed to load payment data: ' + err.message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopNav 
        title="Reports" 
        subtitle="Access Trucking Pros Financial forms and applications"
      />
      
      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
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
          {/* TPF Payment Details */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-8 py-6">
              <h2 className="text-3xl font-bold text-white mb-2">
                TPF Payment Details
              </h2>
              <p className="text-blue-100">
                View payment information and account details from Trucking Pros Financial
              </p>
            </div>
            
            <div className="p-6">
              {loading && (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                  <span className="ml-4 text-lg text-gray-600 dark:text-gray-300">Loading payment details...</span>
                </div>
              )}
              
              {error && (
                <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-red-600 dark:text-red-400 text-lg">{error}</p>
                </div>
              )}
              
              {paymentData && (
                <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <div 
                    className="payment-table-container min-w-full [&_table]:w-full [&_table]:border-collapse [&_table]:bg-white [&_table]:dark:bg-gray-800 [&_table]:rounded-lg [&_table]:overflow-hidden [&_table]:shadow-sm [&_thead]:bg-gradient-to-r [&_thead]:from-gray-50 [&_thead]:to-gray-100 [&_thead]:dark:from-gray-700 [&_thead]:dark:to-gray-600 [&_th]:px-6 [&_th]:py-4 [&_th]:text-left [&_th]:font-bold [&_th]:text-gray-900 [&_th]:dark:text-gray-100 [&_th]:text-sm [&_th]:uppercase [&_th]:tracking-wider [&_th]:border-b-2 [&_th]:border-gray-200 [&_th]:dark:border-gray-600 [&_tbody_tr]:border-b [&_tbody_tr]:border-gray-200 [&_tbody_tr]:dark:border-gray-700 [&_tbody_tr:hover]:bg-blue-50 [&_tbody_tr:hover]:dark:bg-gray-700 [&_tbody_tr:hover]:transition-colors [&_td]:px-6 [&_td]:py-4 [&_td]:text-gray-900 [&_td]:dark:text-gray-100 [&_td]:font-medium [&_.to_right]:text-right [&_.to_right]:font-bold"
                    dangerouslySetInnerHTML={{ __html: paymentData }}
                  />
                </div>
              )}
            </div>
            
            
          </div>
          
          {/* Support Section */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-6 border border-green-200 dark:border-green-800">
            <div className="text-center">
              <h3 className="text-xl font-semibold text-green-900 dark:text-green-100 mb-2">
                🚛 Need Assistance?
              </h3>
              <p className="text-green-700 dark:text-green-200 mb-6">
                Our support team is available to help you with forms, applications, and any questions about TPF services.
              </p>
              <div className="flex justify-center gap-4">
                <a 
                  href="mailto:support@truckingprosfinancial.com" 
                  className="inline-flex items-center px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors shadow-md"
                >
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Email Support
                </a>
                <a 
                  href="tel:+1-800-TPF-HELP" 
                  className="inline-flex items-center px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors shadow-md"
                >
                  <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                  </svg>
                  Call Support
                </a>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}