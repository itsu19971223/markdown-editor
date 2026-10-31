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


@app.route('/home.html')
def home_page():
    return render_template('home.html')


@app.route('/demo')
def demo():
    return render_template('demo.html')


@app.route('/editor')
def editor():
    if 'user_id' not in session:
        return redirect(url_for('login'))
    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, name, email FROM users WHERE id = ?',
            (session['user_id'],)
        ).fetchone()
    finally:
        conn.close()
    if user is None:
        session.clear()
        return redirect(url_for('login'))
    return render_template('index.html', current_user=user)


@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/account', methods=['POST'])
def update_account():
    if 'user_id' not in session:
        return redirect(url_for('login'))

    name = request.form.get('name', '').strip()
    email = request.form.get('email', '').strip()
    current_password = request.form.get('current_password', '')
    new_password = request.form.get('new_password', '')
    if not name or not email:
        flash('Name and email are required.')
        return redirect(url_for('editor'))

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT password_hash FROM users WHERE id = ?',
            (session['user_id'],)
        ).fetchone()
        if user is None:
            session.clear()
            return redirect(url_for('login'))

        if new_password:
            if not current_password or not check_password_hash(
                user['password_hash'], current_password
            ):
                flash('Enter your current password to change your password.')
                return redirect(url_for('editor'))
            conn.execute(
                'UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?',
                (
                    name,
                    email,
                    generate_password_hash(new_password, method='scrypt'),
                    session['user_id']
                )
            )
        else:
            conn.execute(
                'UPDATE users SET name = ?, email = ? WHERE id = ?',
                (name, email, session['user_id'])
            )
        conn.commit()
    except sqlite3.IntegrityError:
        flash('That email address is already in use.')
        return redirect(url_for('editor'))
    finally:
        conn.close()

    flash('Your account has been updated.')
    return redirect(url_for('editor'))


@app.route('/signup', methods=['GET', 'POST'])
def signup():
    if request.method == 'POST':
        is_json = request.is_json
        data = request.get_json(silent=True) if is_json else request.form
        if not hasattr(data, 'get'):
            if is_json:
                return jsonify(message='Please provide a valid name, email, and password.'), 400
            flash('Please provide a valid name, email, and password.')
            return redirect(url_for('signup'))

        name = data.get('name', '')
        email = data.get('email', '')
        password = data.get('password', '')
        if not all(isinstance(value, str) for value in (name, email, password)):
            if is_json:
                return jsonify(message='Please provide a valid name, email, and password.'), 400
            flash('Please provide a valid name, email, and password.')
            return redirect(url_for('signup'))

        name = name.strip()
        email = email.strip()
        if not name or not email or not password:
            if is_json:
                return jsonify(message='Name, email, and password are required.'), 400
            flash('Name, email, and password are required.')
            return redirect(url_for('signup'))

        hashed_password = generate_password_hash(password, method='scrypt')
        try:
            conn = get_db_connection()
            try:
                conn.execute(
                    'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
                    (name, email, hashed_password)
                )
                conn.commit()
            finally:
                conn.close()
        except sqlite3.IntegrityError:
            if is_json:
                return jsonify(message='Email already registered.'), 409
            flash('Email already registered.')
            return redirect(url_for('signup'))

        if is_json:
            return jsonify(redirectTo=url_for('login')), 201
        return redirect(url_for('login'))
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
    
