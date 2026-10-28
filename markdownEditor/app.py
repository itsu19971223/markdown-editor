import flask
import os
import sqlite3
from flask import Flask, jsonify, render_template, request, redirect, session, url_for, flash
from werkzeug.security import generate_password_hash, check_password_hash


app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or os.urandom(32)


def get_db_connection():
    conn = sqlite3.connect('database.db')
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db_connection()
    with open('schema.sql', 'r') as f:
        conn.executescript(f.read())
    conn.close()


@app.route('/')
def index():
    return render_template('home.html')


@app.route('/editor')
def editor():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    return render_template('index.html')


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        name = request.form['name']
        email = request.form['email']
        password = request.form['password']


        hashed_password = generate_password_hash(password, method='scrypt')


        try:
            conn = get_db_connection()
            conn.execute(
                'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
                (name, email, hashed_password)
            )
            conn.commit()
            conn.close()
            return redirect(url_for('login'))
        except sqlite3.IntegrityError:
            return "Email already registered!"
            
    return render_template('signup.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        email = data.get('email', '').strip()
        password = data.get('password', '')

        if not email or not password:
            if request.is_json:
                return jsonify(message='Email and password are required.'), 400
            flash('Email and password are required.')
            return redirect(url_for('login'))


        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()


        if user and check_password_hash(user['password_hash'], password):
            session['user_id'] = user['id']
            if request.is_json:
                return jsonify(redirectTo=url_for('editor'))
            return redirect(url_for('editor'))

        if request.is_json:
            return jsonify(message='Invalid email or password.'), 401
        flash('Invalid email or password.')
        return redirect(url_for('login'))


    return render_template('login.html')


if __name__ == '__main__':
    init_db()
    app.run(debug=True)
    
