import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";

export default function CutoffTimes() {
  return (
    <Card className="bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 shadow-lg">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center space-x-2 text-lg font-semibold text-gray-900 dark:text-white">
          <Clock className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <span>Daily Cut-off Times</span>
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
          <div>
            <p className="font-medium text-blue-900 dark:text-blue-100">ACH Cut-off</p>
            <p className="text-sm text-blue-700 dark:text-blue-300">Automated Clearing House</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-blue-900 dark:text-blue-100">2:15 PM</p>
            <p className="text-sm text-blue-700 dark:text-blue-300">MST</p>
          </div>
        </div>

        <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
          <div>
            <p className="font-medium text-green-900 dark:text-green-100">WIRE Cut-off</p>
            <p className="text-sm text-green-700 dark:text-green-300">Wire Transfer</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-green-900 dark:text-green-100">1:15 PM</p>
            <p className="text-sm text-green-700 dark:text-green-300">MST</p>
          </div>
        </div>

        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            All times are Mountain Standard Time (MST)
          </p>
        </div>
      </CardContent>
    </Card>
  );
}