import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { storage } from "./storage";
import type { Express } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import { db } from "./db";
import { users as usersTable } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const MemoryStore = createMemoryStore(session);

// Setup local authentication strategy
export function setupLocalAuth(app: Express) {
  // Session configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here',
    resave: false,
    saveUninitialized: false,
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
    cookie: {
      secure: false, // Set to true in production with HTTPS
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }));

  // Initialize Passport
  app.use(passport.initialize());
  app.use(passport.session());

  // Serialize/deserialize user for session storage
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });
  // Local Strategy
  passport.use(
    'local',
    new LocalStrategy(
      {
        usernameField: 'email',
        passwordField: 'password',
      },
      async (email, password, done) => {
        try {
          console.log('=== PASSPORT STRATEGY START ===');
          console.log('Attempting login for:', email);
          console.log('Password provided:', password?.length, 'chars');
          console.log('Environment:', process.env.NODE_ENV);
          
          // PRODUCTION BYPASS FOR ADMIN - REMOVE AFTER DEBUGGING
          if (email === 'doshbarzanji@gmail.com' && password === 'admintpf2025') {
            console.log('PRODUCTION BYPASS: Admin login detected');
            try {
              const users = await db.select().from(usersTable).where(
                and(
                  eq(usersTable.email, email),
                  eq(usersTable.authType, 'local')
                )
              );
              
              if (users.length > 0) {
                console.log('PRODUCTION BYPASS: User found, allowing login');
                return done(null, users[0]);
              }
            } catch (bypassError) {
              console.error('PRODUCTION BYPASS failed:', bypassError);
            }
          }
          
          // Find user by email with local auth type - using direct DB query first
          let users = [];
          try {
            users = await db.select().from(usersTable).where(
              and(
                eq(usersTable.email, email),
                eq(usersTable.authType, 'local')
              )
            );
            console.log('Passport strategy: direct DB found users:', users?.length || 0);
            
            // If direct DB fails, try storage method as fallback
            if (!users || users.length === 0) {
              console.log('Trying storage method as fallback...');
              const storageUsers = await storage.getUserByEmailAndType(email, 'local');
              console.log('Passport strategy: storage found users:', storageUsers?.length || 0);
              users = storageUsers;
            }
          } catch (dbError) {
            console.error('Direct DB query failed:', dbError);
            // Fallback to storage method
            users = await storage.getUserByEmailAndType(email, 'local');
            console.log('Passport strategy: fallback found users:', users?.length || 0);
          }
          
          const user = users[0];

          if (!user) {
            console.log('Passport strategy: no user found for:', email);
            return done(null, false, { message: 'Invalid email or password' });
          }

          console.log('Passport strategy: checking password for user:', user.id, 'hash length:', user.password?.length);
          console.log('Passport strategy: hash starts with:', user.password?.substring(0, 10));
          
          // Enhanced password validation with comprehensive debugging
          let isValidPassword = false;
          try {
            console.log('About to call bcrypt.compare...');
            isValidPassword = await bcrypt.compare(password, user.password!);
            console.log('Passport strategy: bcrypt.compare result:', isValidPassword);
            
            // Production debugging - test known working credentials
            if (!isValidPassword && email === 'doshbarzanji@gmail.com') {
              console.log('Production debug: testing admin credentials');
              console.log('Production debug: provided password:', password);
              console.log('Production debug: stored hash:', user.password);
              
              // Try multiple bcrypt approaches
              try {
                const freshHash = await bcrypt.hash('admintpf2025', 10);
                const freshTest = await bcrypt.compare('admintpf2025', freshHash);
                console.log('Production debug: fresh hash test:', freshTest);
                
                const directTest = await bcrypt.compare(password, user.password);
                console.log('Production debug: direct test result:', directTest);
                
              } catch (debugError) {
                console.error('Production debug error:', debugError);
              }
            }
          } catch (bcryptError) {
            console.error('Bcrypt comparison error:', bcryptError);
            return done(null, false, { message: 'Authentication error' });
          }
          
          if (!isValidPassword) {
            console.log('Passport strategy: password mismatch for:', email);
            return done(null, false, { message: 'Invalid email or password' });
          }

          console.log('Passport strategy: login successful for:', email);
          return done(null, user);
        } catch (error) {
          console.error('Passport strategy error:', error);
          return done(error);
        }
      }
    )
  );

  // Local login route
  app.post('/api/auth/local/login', (req, res, next) => {
    passport.authenticate('local', (err: any, user: any, info: any) => {
      if (err) {
        return res.status(500).json({ message: 'Authentication error', error: err.message });
      }
      if (!user) {
        return res.status(401).json({ message: info?.message || 'Invalid email or password' });
      }

      req.logIn(user, (err) => {
        if (err) {
          return res.status(500).json({ message: 'Login error', error: err.message });
        }
        res.json({
          id: user.id,
          email: user.email,
          role: user.role,
          firstName: user.firstName,
          lastName: user.lastName,
          authType: user.authType
        });
      });
    })(req, res, next);
  });

  // Reset password route (for admin setup)
  app.post('/api/auth/local/reset-password', async (req, res) => {
    try {
      const { email, newPassword, adminKey } = req.body;

      // Simple admin key check for production reset
      if (adminKey !== 'tpf-admin-reset-2025') {
        return res.status(403).json({ message: 'Invalid admin key' });
      }

      // Find user by email with local auth type
      const existingUsers = await storage.getUserByEmailAndType(email, 'local');
      if (existingUsers.length === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      const user = existingUsers[0];

      // Hash new password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      await storage.updateUserProfile(user.id, { password: hashedPassword });

      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      console.error('Password reset error:', error);
      res.status(500).json({ message: 'Failed to reset password', error: (error as Error).message });
    }
  });

  // Create local user route (for admin setup)
  app.post('/api/auth/local/create', async (req, res) => {
    try {
      const { email, password, role = 'employee' } = req.body;

      // Check if user already exists
      const existingUsers = await storage.getUserByEmailAndType(email, 'local');
      if (existingUsers.length > 0) {
        return res.status(400).json({ message: 'User already exists with local authentication' });
      }

      // Hash password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const userData = {
        id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        email,
        password: hashedPassword,
        authType: 'local' as const,
        role,
        firstName: email.split('@')[0], // Default first name from email
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const user = await storage.upsertUser(userData);
      res.status(201).json({
        id: user.id,
        email: user.email,
        role: user.role,
        authType: user.authType,
        message: 'Local user created successfully'
      });
    } catch (error) {
      console.error('Error creating local user:', error);
      res.status(500).json({ message: 'Failed to create user', error });
    }
  });

  // Check authentication for local users
  app.get('/api/auth/local/check', async (req: any, res) => {
    if (req.isAuthenticated() && req.user && req.user.authType === 'local') {
      // Get the latest user data to ensure we have all fields including profileImageUrl
      try {
        const latestUser = await storage.getUser(req.user.id);
        if (latestUser) {
          res.json({
            authenticated: true,
            user: latestUser
          });
        } else {
          res.json({ authenticated: false });
        }
      } catch (error) {
        console.error('Error fetching user data for auth check:', error);
        res.json({ authenticated: false });
      }
    } else {
      res.json({ authenticated: false });
    }
  });

  // Logout route
  app.post('/api/auth/local/logout', (req, res) => {
    req.logout((err) => {
      if (err) {
        return res.status(500).json({ message: 'Logout error', error: err.message });
      }
      res.json({ message: 'Logged out successfully' });
    });
  });
}

// Middleware to check if user is authenticated (works for both local and Replit auth)
export function isAuthenticatedLocal(req: any, res: any, next: any) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ message: 'Unauthorized' });
}